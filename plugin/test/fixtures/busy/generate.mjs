#!/usr/bin/env node
// THE BUSY WORKSPACE's generator (README.md beside this file; the worst-case rule). It READS the
// recorded answers the fixtures hold and WRITES the busy answers: the same kernel answers, with
// their rows MULTIPLIED. Every busy row is one recorded row with only its names, ids, times and
// relations varied (and a count that follows the rows): `build()` says, for every row it makes,
// the recorded row it came from and exactly what it varied, and test/busy/busy.test.ts puts each
// back and holds it equal to its recorded row.
//
// No clock, no random, no dependency: the same set every run.
//   node test/fixtures/busy/generate.mjs            writes the files beside this script
//   node test/fixtures/busy/generate.mjs --out DIR  writes them into DIR (the test's scratch)
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "..");
const recorded = (file) => {
  const document = JSON.parse(readFileSync(join(FIXTURES, file), "utf8"));
  return document.result ?? document;
};
const copy = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/** Every string of `value` with each `[from, to]` replaced, in order. */
export function swapped(value, swaps) {
  if (typeof value === "string") return swaps.reduce((text, [from, to]) => text.split(from).join(to), value);
  if (Array.isArray(value)) return value.map((each) => swapped(each, swaps));
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, each]) => [key, swapped(each, swaps)]));
  return value;
}
const at = (value, path) => path.reduce((inner, key) => (inner === null || inner === undefined ? undefined : inner[key]), value);
function put(value, path, next) {
  const last = path[path.length - 1];
  const holder = path.slice(0, -1).reduce((inner, key) => inner[key], value);
  if (next === undefined) delete holder[last];
  else holder[last] = next;
}
/**
 * One busy row: `from` (a recorded row) with `swaps` applied to every string (a name, an id) and
 * `set` (by path: a relation, a time, a text) put in. → the row, and what was varied, so that it
 * can be put back: `restored(made)` is the recorded row again, or this throws (a name that hides
 * inside another would not come back).
 */
function vary(from, swaps, set = []) {
  const row = swapped(copy(from), swaps);
  const was = set.map(([path]) => [path, copy(at(from, path))]);
  for (const [path, next] of set) put(row, path, next);
  const made = { row, from, swaps, was };
  if (!isDeepStrictEqual(restored(made), from)) throw new Error(`busy: a row made from ${JSON.stringify(from).slice(0, 80)}… does not come back to it: a varied name hides inside another`);
  return made;
}
/** The recorded row a busy row was made from: its varied fields put back. */
export function restored({ row, swaps, was }) {
  const back = copy(row);
  for (const [path, value] of was) put(back, path, value);
  return swapped(back, [...swaps].reverse().map(([from, to]) => [to, from]));
}

// ---- made-up names (no person, no real project) ----
const TOPICS = [
  "customer-onboarding-redesign-for-enterprise-tier", // 48: with "-developer-1", a name of sixty characters
  "customer-onboarding-redesign-for-the-starter-tier", // reads like the one above where a name is cut
  "billing-reconciliation-pipeline-migration",
  "search-relevance-ranking-experiments",
  "mobile-offline-sync-conflict-resolution",
  "quarterly-compliance-evidence-collection",
];
const ALONE = ["nightly-dependency-audit", "release-notes-drafting", "flaky-test-quarantine", "docs-site-link-checker", "incident-postmortem-timeline", "api-deprecation-sweep", "localization-string-freeze", "accessibility-contrast-audit", "telemetry-schema-registry", "invoice-pdf-rendering", "support-inbox-triage", "design-token-export"];
const SOUL_WORDS = ["platform", "payments", "search", "mobile", "compliance", "growth", "data", "design", "support", "infrastructure", "security", "billing", "documentation", "release", "research"];
/** A recorded time, `minutes` later (earlier, if negative): a varied time stays beside the recorded times of its row. */
const later = (time, minutes) => new Date(Date.parse(time) + minutes * 60_000).toISOString();
const QUESTION = ["The migration is ready to run against production.", "It rewrites 48 000 invoices and cannot be undone once the old table is dropped.", "A dry run on the copy of last night took 41 minutes and changed nothing it should not.", "Run it now, wait for the Sunday window, or stop here?"].join("\n");
// The busy chat's board: twelve facts [label, value] and nine questions (the fourth is four lines long).
// (The recorded facts are two, taken in turn: one with a link, one counted "failing": the made-up labels follow them.)
const BOARD_FACTS = [["Pull request", "#1842"], ["Tests", "17"], ["Branch", "agents/nightly-dependency-audit-probe/upgrade-the-payment-client-and-three-pins"], ["Checks", "3"], ["Build", "#20418"], ["Advisories", "9"], ["Reviewer", "release-notes-drafting-helper"], ["Lockfile checks", "14"], ["Estimated time left for the whole upgrade across every service", "about three working days"], ["Slowest checkout request in the end-to-end run", "1840"], ["Blocked on", "the payments team's answer on the idempotency key, due before Friday's freeze"], ["Audits", "2"]];
// The board's texts are AT THE KERNEL's OWN BOUNDS, not past them: an option of 60 characters, a question of 200, a
// value of 80, a unit of 16 (the board's own contract).
const BOARD_LINK = "https://dependency-audit-preview-1842-payments-and-billing-platform-staging-eu-central.code-review.example.invalid/pull/1842";
const BOARD_OPTIONS = [
  ["Upgrade the payment client now, with the key stored per try", "Pin it until the release, with a note of why and until when", "Upgrade behind a flag, one region first, the old one a week", "Hand it to the payments team with what this agent has found"],
  ["One pull request per service: fourteen, each small to read", "One for all fourteen: a single review, a single revert", "One per team that owns services: four, by who must approve", "Lockfiles first in one, then one per major version moved"],
  ["Accept the advisory with a note and a check of every path", "Replace the library with the one the build tooling uses", "Turn the import off until a fix is published upstream", "Ask the customer's own security contact what they accept"],
];
const BOARD_QUESTIONS = [
  "Which base branch?",
  "Upgrade the payment client across a major version now, or pin it until the release?",
  // (200 characters, one line: as long as a question may be.)
  "The image library's fixed release changes its licence to one that asks for the sources of any distributed work linking to it; the mobile clients link to it and are distributed: who signs it off, when?",
  // (Four lines, within the 200 characters a board's question may have.)
  ["The migration is ready to run on production.", "It rewrites 48 000 invoices and cannot be undone.", "A dry run took 41 minutes and changed nothing else.", "Run it now, wait for Sunday, or stop here?"].join("\n"),
  "Drop support for the old runtime in this pass?",
  "Open one pull request per service, or one for all fourteen?",
  "The advisory on the archive reader has no fix yet: accept it with a note, or replace the library?",
  "Run the audit nightly from now on?",
  "Tell the mobile team before or after the lockfiles change?",
];
// THE BUSY CHAT (chat.json): a long conversation with the agent that holds the full board: many turns, long messages,
// paragraphs, a list, a code block. A conversation is no answer of the kernel's: nothing of it is recorded, and all of
// it is made up here. The live stage `busy` has it with the mock model, turn by turn (each `agent` is what the mock
// answers to `you`). Every `you` differs from every other: the mock finds its answer by it.
const CHAT = [
  ["Audit the dependencies of every service in this repository and tell me what is behind, what has an open advisory, and what you would upgrade first.", "I went through all fourteen lockfiles. Here is where things stand.\n\n**Behind.** 63 packages are behind their latest release. Most are a patch or a minor version away and upgrade without a change of ours. Nine are a major version behind, and three of those are in the request path of the payments service, which is where I would be most careful.\n\n**Open advisories.** Nine, in five packages:\n\n- the payment client (two, both fixed in its next major version)\n- the archive reader (one, no fix published yet)\n- the image library (three, fixed in a release that also changes its licence)\n- the template engine (two, fixed in a patch release)\n- the date parser (one, fixed in a patch release)\n\n**What I would upgrade first.** The template engine and the date parser: both are patch releases, both close advisories, and neither changes an interface we call. After that the payment client, which is the largest piece of work and the one that matters most."],
  ["Start with the two patch releases. Show me the change before you commit anything.", "Both are one line each in four lockfiles. This is the whole change for the template engine in the billing service; the other three services read the same.\n\n```diff\n--- a/services/billing/package.json\n+++ b/services/billing/package.json\n@@ -31,7 +31,7 @@\n     \"dependencies\": {\n       \"date-parser\": \"4.2.0\",\n-      \"template-engine\": \"7.1.3\",\n+      \"template-engine\": \"7.1.9\",\n       \"payment-client\": \"2.18.4\"\n     }\n```\n\nI ran the unit suites of the four services against it: 2 318 tests, all passing, in a little under six minutes. Nothing is committed yet."],
  ["Good. Commit those and open the pull request. Then tell me what the payment client's major version changes for us.", "Committed and opened as pull request #1842; the board has its number and the state of its checks.\n\nThe payment client's next major version changes three things we depend on.\n\nFirst, every amount is an integer of the currency's smallest unit; today we pass decimals as strings in eleven places, and each of them needs a conversion that rounds the way the ledger does. I would write that conversion once, with the ledger's own rounding tests run against it, and call it from all eleven.\n\nSecond, a retried request must carry an idempotency key of ours. The client used to make one itself; it no longer does. Our retry wrapper has to make the key before the first attempt and reuse it, or a timeout followed by a retry can charge a card twice.\n\nThird, webhooks are verified with a new signature scheme, and the old one stops being accepted ninety days after the upgrade. Both can be accepted side by side during that window."],
  ["How long is that, honestly? And what could go wrong that the tests would not catch?", "About three working days for the change and its tests, and I would not compress it.\n\nWhat the tests would not catch:\n\n1. A rounding difference on a currency with no minor unit or with three decimals. Our fixtures cover two-decimal currencies almost exclusively. I would add cases for each kind before touching the code.\n2. A retry that crosses a deploy. The key is made in memory today; if the process restarts between the first attempt and the retry, the key is gone and the retry is a new charge. It has to be stored with the payment attempt.\n3. A webhook that arrives signed the old way after the window closes, from an account that was never migrated. Nothing in our suite plays the provider's side of that.\n\nThe second is the one I would lose sleep over."],
  ["Agreed on the second. Write the key with the payment attempt, in the same transaction. What about the archive reader, with no fix published?", "The advisory on the archive reader is a path that escapes the directory it unpacks into when an archive holds a crafted entry. We unpack archives in exactly one place: the import of a customer's export, in the support tools, run by a person of ours on a file a customer sent.\n\nThere are two ways forward and I have put the choice on the board, because it is yours:\n\n- **Accept it with a note** until a fix is published. The exposure is one internal tool, and I can add a check of every entry's path before it is unpacked, which closes this hole whatever the library does.\n- **Replace the library** with the one the build tooling already uses. It has no open advisory, but its interface differs and the import would need rewriting: about a day, with a real risk of breaking an import nobody has a test for.\n\nI would take the first, with the check."],
  ["Take the first, with the check. Now the image library and its licence.", "The fixed release of the image library moves from a permissive licence to one that requires the source of a distributed work that links to it to be offered on request. We link to it in the mobile clients, which we distribute, and in the thumbnail service, which we do not.\n\nThat is a question for whoever signs off licences here, not for me, and it is on the board as one. What I can say about the code: the three advisories are all in the decoder for one image format, and we could turn that format off in the build of the version we have today. That closes the three advisories without the upgrade and without the licence, at the cost of not reading that format, which last month was 0.3 % of uploads."],
  ["Turn the format off in the mobile builds for now, keep it in the thumbnail service, and leave the licence question on the board.", "Done in both mobile builds, behind the build flag that already selects decoders, so it is one line each and reverts the same way. An upload in that format now gets the message we already show for a format we do not read.\n\nThe thumbnail service keeps the format and is upgraded to the fixed release: it is not distributed, so the licence asks nothing of us there. Its suite passes, and I compared the thumbnails of the two hundred sample images before and after, byte for byte: 197 are identical, and the three that differ are the three whose decoding the fix changes."],
  ["Where are we overall? Short.", "Short:\n\n- Patch releases: merged-ready in #1842, checks green but for one flaky test I have rerun twice.\n- Payment client: design agreed, key stored with the attempt; not started. Three days.\n- Archive reader: accepted with a path check; the check is written and tested.\n- Image library: format off in mobile, upgraded in thumbnails; licence question open on the board.\n- Everything else behind: 51 packages, patch and minor, in one pull request per service unless you would rather have one for all fourteen. That is on the board too.\n\nNine questions are open on the board. The first one blocks me now: which base branch."],
  ["Which test is flaky?", "`ledger › closes a period that spans a daylight-saving change`. It fails when the suite starts within a minute of the hour in the build machine's zone: the test builds its period from the current time instead of a fixed one. It failed once in the first run and passed in the two after it.\n\nIt is not caused by this change, and I have not touched it. I would fix it in a pull request of its own, by giving the test a fixed clock, so that #1842 stays the two patch releases and nothing else."],
  ["Yes, its own pull request. Keep going on the rest while I look at the board.", "Understood. While you look at the board I am doing what needs none of its answers: the fixed clock for the ledger test, and the rounding cases for currencies with no minor unit and with three decimals, written against the code as it is today so that they pass before the payment client changes anything.\n\nI will stop at the payment client itself until the base branch is settled."],
];
// The busy chat's MAIL: fifty messages received, a full page. [subject, body]: every third message keeps the recorded
// long report's body (16 KiB, cut by the messaging layer); the others say a few lines. Subjects: short, and long.
// HOW OLD each of the fifty is, in minutes before the newest (which keeps its recorded time): a spread, each about a
// third older than the one before: minutes, hours, days, months, and more than a year for the oldest. (The live stage
// moves the whole page so that its newest message is "just now" at the run: the gaps are these.)
const MAIL_AGES = (() => {
  const ages = [0];
  for (let n = 1; n < 50; n += 1) ages.push(ages[n - 1] + Math.floor((ages[n - 1] * 32) / 100) + 1);
  return ages;
})();
const LONG_AUTOMATION = ["of-every-open-pull-request-across-all-fourteen-services", "for-the-payments-and-billing-platform-in-every-region", "after-each-release-train-leaves-the-staging-cluster", "with-a-summary-for-the-owning-team-and-follow-ups"];
const MAIL_SUBJECTS = ["Lockfile audit: results", "Re: Re: Re: the payment client's major version, the idempotency key and what happens to a retry that crosses a deploy", "Advisory on the archive reader", "Licence question for the image library: who signs off, and by when do the mobile builds need the answer?", "Flaky: ledger closes a period that spans a daylight-saving change", "Thumbnails compared", "Base branch?", "Fourteen pull requests or one: a note on what each service's owners said when I asked them last week", "Checks on #1842", "Rounding cases for currencies with no minor unit"];
const MAIL_BODIES = ["The audit of the fourteen lockfiles is done. 63 packages are behind, nine advisories are open.\n\nThe two patch releases are ready in #1842.", "Your question on the base branch is still open on my board.\n\n- main: the default\n- release: the 0.1 line\n\nI stop at the payment client until it is settled.", "One test failed once and passed twice. It is not this change.\n\nI will fix it in a pull request of its own."];
const LONG = (what) => `${what}: every weekday at the start of the working day in each region, with a summary posted to the owning team and a follow-up opened for anything left undone`;

export function build() {
  const made = { agents: [], souls: [], capabilities: [], soulCapabilities: [], schedules: [], triggers: [], teams: [], servers: [], runs: [], triggerStates: [], facts: [], questions: [], mail: [], messages: [], conversations: [], groups: [], problems: [] };

  // ---- capabilities: the recorded twelve, then eighteen more (30) ----
  // The eighteen are recorded rows under longer names: two more of each capability the fullest soul has (below), three
  // more of the one that fills the knowledge place (a core place then holds FOUR: the Workspace page names three and
  // counts the rest), and one more of five others.
  const capabilitiesDoc = recorded("workspace/capabilities.json");
  const capabilityOf = (name) => capabilitiesDoc.capabilities.find((row) => row.name === name);
  const MORE_CAPABILITIES = ["oats.aweb", "oats.build", "oats.core", "oats.developer", "oats.landing-rules", "oats.aweb", "oats.build", "oats.core", "oats.developer", "oats.landing-rules", "oats.okf", "oats.okf", "oats.okf", "oats.code-review", "oats.desktop-ui", "oats.maintainer", "oats.okf-harvest", "oats.workspace-experts"];
  for (const from of capabilitiesDoc.capabilities) made.capabilities.push(vary(from, []));
  const moreNames = MORE_CAPABILITIES.map((model, n) => `oats.${SOUL_WORDS[(n * 5 + 2) % SOUL_WORDS.length]}-${SOUL_WORDS[(n * 3 + 7) % SOUL_WORDS.length]}-${["review-and-ship", "delivery"][n % 2]}-${model.slice("oats.".length)}-${n + 1}`);
  MORE_CAPABILITIES.forEach((model, n) => made.capabilities.push(vary(capabilityOf(model), [[model, moreNames[n]]])));
  const capabilities = { ...copy(capabilitiesDoc), capabilities: made.capabilities.map((each) => each.row) };

  // ---- souls: the recorded souls, each multiplied (24) ----
  const soulsDoc = recorded("workspace/souls.json");
  // ONE soul with FIFTEEN capabilities (a soul's page lists eight and offers the rest): the recorded soul that has five,
  // with two more of each: every row of its list is one of its recorded rows, under a busy capability's name.
  const FULLEST = "oats-developer";
  const fullest = soulsDoc.souls.find((soul) => soul.name === FULLEST);
  for (const from of fullest.capabilities) made.soulCapabilities.push(vary(from, []));
  MORE_CAPABILITIES.slice(0, 10).forEach((model, n) => made.soulCapabilities.push(vary(fullest.capabilities.find((row) => row.name === model), [[model, moreNames[n]]])));
  const soulModels = soulsDoc.souls.filter((soul, index, all) => all.findIndex((other) => other.name === soul.name) === index);
  const busySouls = [];
  for (let n = 0; n < 24; n += 1) {
    const from = soulModels[n % soulModels.length];
    const turn = Math.floor(n / soulModels.length);
    // The recorded souls stand as they are (their names are the roster's groups); the others are longer names of the same shape.
    const name = turn === 0 ? from.name : `${SOUL_WORDS[(n * 7) % SOUL_WORDS.length]}-${["feature-delivery", "quality-and-release-readiness"][turn - 1]}-${from.name}`;
    const row = vary(from, turn === 0 ? [] : [[from.name, name]], turn === 0 ? (from.name === FULLEST ? [[["capabilities"], made.soulCapabilities.map((each) => each.row)]] : []) : [[["description"], LONG(`Works on ${name.replace(/-/g, " ")}`)]]);
    made.souls.push(row);
    // The name the roster gives this soul's agents: the soul's own, or `<package>--<soul>` for a package's soul ("." written "-").
    busySouls.push(typeof row.row.package === "string" ? `${row.row.package.replaceAll(".", "-")}--${name}` : name);
  }
  const souls = { ...copy(soulsDoc), souls: made.souls.map((each) => each.row) };

  // ---- the roster: the recorded rows of each kind, multiplied (60, four levels) ----
  const status = recorded("roster/status.json");
  const rowsOf = (document) => document.agents.flatMap((group) => group.instances.map((row) => ({ row, soul: group.name ?? row.agent })));
  const byName = new Map(rowsOf(status).map((each) => [each.row.instance, each]));
  const outside = rowsOf(recorded("outside/status-outside.json"))[0];
  const lostBb = rowsOf(recorded("outside/status-archived-while-running.json"))[0];
  const tmuxLost = { row: recorded("lifecycle/tmux-row-lost.json"), soul: recorded("lifecycle/tmux-row-lost.json").agent };
  const boardRow = rowsOf(recorded("panel/status-board.json")).find((each) => each.row.board !== undefined && each.row.board !== null);
  const MODELS = {
    ask: ["release-070-maintainer", "flaky-ci-developer", "ranker-v3-probe"].map((name) => byName.get(name)),
    work: [byName.get("redesign-ui-lead"), byName.get("desktop-mockups-developer")],
    idle: [byName.get("harvest-knowledge-helper")],
    stopped: [byName.get("weekly-digest-helper")],
    // FAILED AT ITS START: the kernel's recorded row of a home whose bb thread failed at its start (the pi run's; the
    // outside fixtures' README). It is a lost session's row: what says "failed" is bb's own record of the thread (an
    // error and never a turn), which the live stage makes for real (threads.json names these agents).
    failed: [rowsOf(recorded("outside/status-failed-at-start.json"))[0]],
    outside: [outside],
    lost: [lostBb],
    tmux: [byName.get("kernel-fix-developer")],
    "tmux-lost": [tmuxLost],
    // THE BUSY CHAT's agent: the recorded row with a board (panel/status-board.json), its board multiplied (below).
    board: [boardRow],
  };
  // Who there is: six efforts of eight (a lead, three developers, a helper under each, a reviewer under the first
  // helper: four levels) and twelve agents alone. [name, parent, kind]
  const plan = [];
  const KINDS = {
    lead: ["ask", "work", "work", "idle", "failed", "work"],
    developer: ["ask", "work", "idle", "work", "idle", "stopped", "ask", "work", "tmux", "idle", "work", "lost", "work", "idle", "ask", "outside", "work", "tmux-lost"],
    helper: ["ask", "idle", "tmux", "work", "idle", "failed", "idle", "ask", "tmux-lost", "idle", "work", "stopped", "ask", "idle", "tmux", "lost", "idle", "work"],
    reviewer: ["ask", "idle", "tmux-lost", "work", "idle", "failed"],
    alone: ["board", "work", "idle", "stopped", "tmux", "ask", "outside", "idle", "tmux-lost", "lost", "stopped", "ask"],
  };
  TOPICS.forEach((topic, effort) => {
    const lead = `${topic}-lead`;
    plan.push([lead, null, KINDS.lead[effort]]);
    for (let d = 0; d < 3; d += 1) {
      const developer = `${topic}-developer-${d + 1}`;
      plan.push([developer, lead, KINDS.developer[effort * 3 + d]]);
      const helper = `${topic}-helper-${d + 1}`;
      plan.push([helper, developer, KINDS.helper[effort * 3 + d]]);
      if (d === 0) plan.push([`${topic}-reviewer`, helper, KINDS.reviewer[effort]]);
    }
  });
  ALONE.forEach((topic, n) => plan.push([`${topic}-${["probe", "helper", "developer"][n % 3]}`, null, KINDS.alone[n]]));

  if (new Set(plan.map(([instance]) => instance)).size !== plan.length || plan.some(([instance]) => !/^[a-z0-9][a-z0-9-]{0,62}$/.test(instance))) throw new Error("busy: an agent's name is taken twice, or is none the kernel would give");
  const used = {};
  const groups = new Map();
  plan.forEach(([instance, parent, kind], n) => {
    const models = MODELS[kind];
    const model = models[(used[kind] = (used[kind] ?? 0) + 1) % models.length];
    const soul = busySouls[(n * 5) % busySouls.length];
    const swaps = [];
    if (model.soul !== soul) swaps.push([`/agents/${model.soul}/`, `/agents/${soul}/`]);
    swaps.push([model.row.instance, instance]);
    const thread = model.row.session?.threadId;
    if (typeof thread === "string") swaps.push([thread, `thr_busy_${String(n + 1).padStart(2, "0")}`]);
    const set = [[["agent"], soul], [["parentInstance"], parent]];
    // A relation FOLLOWS the parent, where the recorded row says one (a kernel that does: the rows with a board): a
    // child is "child" of its parent; a root has neither key, as the recorded roots.
    if ("relation" in model.row || "relativeTo" in model.row) set.push([["relation"], parent === null ? undefined : "child"], [["relativeTo"], parent === null ? undefined : parent]);
    // The person a recorded row names is no part of the set: a made-up name in its place.
    if (typeof model.row.attributedHuman === "string") set.push([["attributedHuman"], "ada"]);
    if (kind === "ask") set.push([["waitingOnYou", "since"], later(model.row.waitingOnYou.since, n * 37)], [["waitingOnYou", "message"], n % 2 === 0 ? QUESTION : `${model.row.waitingOnYou.message} (${instance.replace(/-/g, " ")})`]);
    if (kind === "board") {
      // A FULL BOARD: the recorded facts and the recorded question, multiplied: twelve facts, nine open questions (one
      // of four lines). The claim follows the board, as the kernel's does: it says the oldest question.
      const board = model.row.board;
      const facts = Array.from({ length: 12 }, (_, f) => {
        const from = board.facts[f % board.facts.length];
        const [label, value] = BOARD_FACTS[f];
        // (A link stays where the recorded fact has one; the first is on a long host.)
        const link = typeof from.link === "string" && f === 0 ? [[["link"], BOARD_LINK]] : [];
        // (A unit stays where the recorded fact has one; one is as long as a unit may be.)
        const unit = typeof from.unit === "string" && f === 9 ? [[["unit"], "milliseconds p95"]] : [];
        const fact = vary(from, [], [[["key"], `${from.key}-${f + 1}`], [["label"], label], [["value"], value], [["at"], later(from.at, f)], ...link, ...unit]);
        made.facts.push(fact);
        return fact.row;
      });
      const questions = BOARD_QUESTIONS.map((question, q) => {
        const from = board.questions[0];
        // (Three questions have FOUR options, each as long as an option may be; the others keep the recorded two.)
        const four = { 1: 0, 5: 1, 6: 2 }[q];
        const options = four === undefined ? [] : [[["options"], BOARD_OPTIONS[four]]];
        const asked = vary(from, [], [[["id"], `q${q + 1}`], [["question"], question], [["since"], later(from.since, q * 11)], ...options]);
        made.questions.push(asked);
        return asked.row;
      });
      // ITS MESSAGING IDENTITY: the recorded board row has none (its agent was spawned with no messaging), and an agent
      // with none has no Mail tab. So that ONE agent holds the conversation, the board AND the mail, this row takes the
      // `identity` of a second recorded row (the roster's lead), with its own name as the alias: the one field of the
      // set that is JOINED from another recorded row. README.md says so.
      const lent = byName.get("redesign-ui-lead").row.identity;
      set.push([["identity"], swapped(copy(lent), [[lent.alias, instance]])]);
      // WHEN IT WAS MADE: before the oldest of its mail (the busy chat's mail goes back more than a year): a day before it.
      const newestMail = JSON.parse(readFileSync(join(FIXTURES, "mail/mail.json"), "utf8")).result.result.mail.messages.find((message) => message.direction === "received").createdAt;
      set.push([["createdAt"], later(newestMail, -MAIL_AGES[MAIL_AGES.length - 1] - 24 * 60)]);
      set.push([["board"], { ...copy(board), facts, questions }], [["waitingOnYou", "message"], questions[0].question]);
    }
    const row = vary(model.row, swaps, set);
    made.agents.push({ ...row, kind });
    if (!groups.has(soul)) groups.set(soul, []);
    groups.get(soul).push(row.row);
  });
  // A group of the roster: the recorded group, with its soul's name and its rows.
  for (const [soul, instances] of groups) made.groups.push(vary(status.agents[0], [], [[["name"], soul], [["instances"], instances]]));
  const chatRow = made.agents.find((each) => each.kind === "board").row;
  const chatAgent = chatRow.instance;
  // ---- the busy chat's mail: the recorded answer of the mail read (the WHOLE document, its envelope too), its
  // received messages multiplied to a full page of fifty, for the busy chat's agent ----
  // THE DOCUMENT is the recorded FIRST PAGE of a mail read (it says there is more, and carries the cursor that reads
  // it: the Mail tab then offers "Older" under the fifty); THE MESSAGES are the recorded messages of the whole read.
  const mailDoc = JSON.parse(readFileSync(join(FIXTURES, "mail/mail-first-page.json"), "utf8"));
  const recordedMail = JSON.parse(readFileSync(join(FIXTURES, "mail/mail.json"), "utf8")).result.result.mail;
  const received = recordedMail.messages.filter((message) => message.direction === "received");
  const messages = Array.from({ length: 50 }, (_, n) => {
    const from = received[n % received.length];
    const long = from.truncated === true; // the recorded long report: its body stays as the messaging layer cut it
    const number = String(n + 1).padStart(2, "0");
    const subject = long ? `${from.subject} ${n + 1}: ${MAIL_SUBJECTS[n % MAIL_SUBJECTS.length]}` : MAIL_SUBJECTS[n % MAIL_SUBJECTS.length];
    // WHO WROTE IT: the recorded sender, or (two of every three) one of the busy agents, whose names are long: the
    // sender's alias wherever the recorded message writes it (its `from.alias`, and its address).
    const senders = made.agents.map((each) => each.row.instance).filter((instance) => instance !== chatAgent && instance.length >= 55);
    const sender = n % 3 === 0 ? [] : [[from.from.alias, senders[n % senders.length]]];
    const message = vary(from, [[from.id, `${number}${from.id.slice(2)}`], [from.conversationId, `${number}${from.conversationId.slice(2)}`], [mailDoc.result.target.instance, chatAgent], ...sender], [[["subject"], subject], [["threadTitle"], subject], ...(n === 0 ? [] : [[["createdAt"], later(received[0].createdAt, -MAIL_AGES[n]).replace("Z", "+00:00")]]), ...(long || n < received.length ? [] : [[["body"], MAIL_BODIES[n % MAIL_BODIES.length]]])]);
    made.messages.push(message);
    return message.row;
  });
  // A conversation's row follows its message: the recorded row, with that message's conversation.
  const conversations = messages.map((message) => {
    const row = vary(recordedMail.conversations[0], [], [[["id"], message.conversationId]]);
    made.conversations.push(row);
    return row.row;
  });
  const mailHome = (row) => row.home.slice(0, row.home.lastIndexOf("/instances/") + 1);
  const mail = vary(
    mailDoc,
    [[`${mailDoc.result.target.home.slice(0, mailDoc.result.target.home.lastIndexOf("/instances/") + 1)}`, mailHome(chatRow)], [mailDoc.result.target.instance, chatAgent]],
    [[["result", "result", "mail", "messages"], messages], [["result", "result", "mail", "conversations"], conversations]],
  );
  made.mail.push(mail);
  const busyStatus = { ...copy(status), features: copy(recorded("panel/status-board.json").features), agents: made.groups.map((each) => each.row) };

  // ---- automations: the recorded schedules (25) and triggers (12); five fail; some hold fifty runs ----
  const scheduleDoc = recorded("automations/schedule-list.json");
  const triggerDoc = recorded("automations/trigger-list.json");
  const schedule = (id) => scheduleDoc.schedules.find((row) => row.id === id);
  const trigger = (id) => triggerDoc.triggers.find((row) => row.id === id);
  // [recorded id, how many]: the FAILING ones are hourly-check (not launched) ×3 and legacy-herdr (invalid) ×1;
  // status-check ×1 is a launch whose state is UNKNOWN: a warning, not a failure.
  const SCHEDULES = [["daily-review", 5], ["hourly-check", 3], ["legacy-herdr", 1], ["notes-checkpoint", 4], ["status-check", 1], ["weekly-cleanup", 4], ["oats-real/nightly-digest", 3], ["oats-real/reconcile", 1], ["oats-real/release-check", 1], ["oats-real/weekly-report", 2]];
  // …and among the triggers harvest-closed (invalid) ×1: five failing in all.
  const TRIGGERS = [["local/graph-watch", 2], ["local/old-prs", 2], ["local/pr-triage", 2], ["oats-real/docs-review", 1], ["oats-real/harvest-closed", 1], ["oats-real/harvest-review", 2], ["oats-real/proposal-review", 2]];
  const bare = (id) => id.slice(id.lastIndexOf("/") + 1);
  const agentOf = (kind) => made.agents.find((each) => each.kind === kind && each.row.backend === "bb").row;
  const RUN_AGENTS = [agentOf("ask"), agentOf("stopped"), agentOf("work")];
  let s = 0;
  for (const [id, count] of SCHEDULES) {
    for (let k = 0; k < count; k += 1, s += 1) {
      const from = schedule(id);
      // FIVE names of sixty characters (the schedules 2 to 6), the first two alike but for their last character.
      const sixty = (stem, end) => `${`${bare(id)}-${stem}`.slice(0, 58).replace(/-+$/, "").padEnd(58, "x")}-${end}`;
      const name = s >= 2 && s <= 6 ? sixty(LONG_AUTOMATION[Math.max(0, s - 3)], s === 2 ? 1 : s === 3 ? 2 : s) : `${bare(id)}-${ALONE[s % ALONE.length]}`;
      const set = [];
      if (typeof from.description === "string") set.push([["description"], LONG(`${from.description} (${name.replace(/-/g, " ")})`)]);
      // ONE long instruction (the first schedule's second copy): the recorded task, twelve times, numbered.
      if (s === 1 && typeof from.task === "string" && from.task !== "") set.push([["task"], Array.from({ length: 12 }, (_, line) => `${line + 1}. ${from.task.replace(/\n/g, " ")}`).join("\n")]);
      // Fifty runs: the recorded run, fifty times, each with its own id and times; the history's count follows.
      if (k === 0 && Array.isArray(from.recentRuns) && from.recentRuns.length > 0 && typeof from.recentRuns[0].runId === "string") {
        const runs = Array.from({ length: 50 }, (_, r) => {
          // The NEWEST of the fifty is the recorded run (the row's `lastRun` is of it); each older one is an hour before.
          const first = from.recentRuns[0];
          const earlier = (time) => new Date(Date.parse(time) - r * 3_600_000).toISOString();
          // (Each carries the schedule's name wherever the recorded run writes it, as the row's `lastRun` does.)
          // A RELATION, on the first schedule alone: its three newest runs were of three agents of the set (one that
          // asks, one that is stopped, one that works): the run's session names that agent and its home.
          const of = s === 0 && r < RUN_AGENTS.length && first.session && typeof first.session.instance === "string" ? [[["session", "instance"], RUN_AGENTS[r].instance], [["session", "home"], RUN_AGENTS[r].home]] : [];
          const run = r === 0 ? vary(first, [[bare(id), name]], of) : vary(first, [[bare(id), name], [first.runId, `${String(s).padStart(2, "0")}${String(r).padStart(2, "0")}${first.runId.slice(4)}`]], [[["scheduledFor"], earlier(first.scheduledFor)], [["startedAt"], earlier(first.startedAt)], ...of]);
          made.runs.push(run);
          return run.row;
        });
        set.push([["recentRuns"], runs]);
        // …and the row's `lastRun` is of its newest run: where that run is an agent of the set's, it names the same one.
        if (s === 0 && from.lastRun && typeof from.lastRun.instance === "string" && runs[0].session?.instance !== from.recentRuns[0].session?.instance) set.push([["lastRun", "instance"], runs[0].session.instance], [["lastRun", "home"], runs[0].session.home]);
        if (from.history && typeof from.history.stored === "number") set.push([["history", "stored"], runs.length]);
      }
      made.schedules.push(vary(from, [[bare(id), name]], set));
    }
  }
  let t = 0;
  for (const [id, count] of TRIGGERS) {
    for (let k = 0; k < count; k += 1, t += 1) {
      const from = trigger(id);
      const name = `${bare(id)}-${ALONE[(t + 5) % ALONE.length]}`;
      made.triggers.push(vary(from, [[bare(id), name]], typeof from.description === "string" ? [[["description"], LONG(`${from.description} (${name.replace(/-/g, " ")})`)]] : []));
    }
  }
  // ---- the triggers' STATES: the recorded state of each busy trigger's recorded trigger, under its busy name ----
  const stateDoc = recorded("automations/trigger-status.json");
  for (const each of made.triggers) {
    const from = stateDoc.triggers.find((row) => row.id === each.from.id);
    if (from === undefined) throw new Error(`busy: no recorded state of the trigger ${each.from.id}`);
    made.triggerStates.push(vary(from, each.swaps, []));
  }
  const triggerStates = { ...copy(stateDoc), triggers: made.triggerStates.map((each) => each.row) };
  const schedules = { ...copy(scheduleDoc), schedules: made.schedules.map((each) => each.row), triggers: { ...copy(scheduleDoc.triggers), count: made.triggers.length } };
  const triggers = { ...copy(triggerDoc), triggers: made.triggers.map((each) => each.row) };

  // ---- teams (7) and machines (5) ----
  const teamsDoc = recorded("workspace/teams.json");
  const TEAMS = ["oats", "payments-and-billing-platform", "search-and-discovery", "mobile-clients", "docs", "compliance-and-audit-evidence", "developer-experience"];
  const problems = [];
  TEAMS.forEach((label, n) => {
    const from = teamsDoc.teams[n === 0 ? 0 : n === 4 ? 1 : n % 2 === 0 ? 1 : 0];
    const row = vary(from, label === from.label ? [] : [[`/teams/${from.label}`, `/teams/${label}`]], label === from.label ? [] : [[["label"], label], ...(from.team === null ? [] : [[["team"], `${label}:busy.invalid`]]), ...(from.description === null ? [] : [[["description"], LONG(`The ${label.replace(/-/g, " ")} team`)]]), ...(from.default === true ? [[["default"], false]] : [])]);
    made.teams.push(row);
    // An unmapped team's problem row follows it (the recorded problem, for that team).
    const problem = teamsDoc.problems.find((each) => each.label === from.label);
    if (problem !== undefined) {
      const row = vary(problem, label === from.label ? [] : [[`/teams/${from.label}`, `/teams/${label}`], [`team ${from.label} `, `team ${label} `]], label === from.label ? [] : [[["label"], label]]);
      made.problems.push(row);
      problems.push(row.row);
    }
  });
  const teams = { ...copy(teamsDoc), teams: made.teams.map((each) => each.row), problems };
  const serversDoc = recorded("workspace/servers.json");
  const MACHINES = ["devbox", "build", "gpu-training-cluster-east", "staging-eu-central", "customer-sandbox-long-running-evaluations"];
  MACHINES.forEach((label, n) => {
    const from = serversDoc.servers[n % serversDoc.servers.length];
    const host = from.sshHost.split(".")[0];
    made.servers.push(vary(from, n < serversDoc.servers.length ? [] : [[`${host}.invalid`, `${label}.invalid`], [from.id, `${label}-box`]], n < serversDoc.servers.length || from.label === undefined ? [] : [[["label"], label]]));
  });
  const servers = { ...copy(serversDoc), servers: made.servers.map((each) => each.row) };

  return { files: { "status.json": busyStatus, "souls.json": souls, "capabilities.json": capabilities, "schedule-list.json": schedules, "trigger-list.json": triggers, "trigger-status.json": triggerStates, "teams.json": teams, "servers.json": servers, "threads.json": { failedAtStart: made.agents.filter((each) => each.kind === "failed").map((each) => each.row.instance) }, "mail.json": mail.row, "chat.json": { agent: chatAgent, turns: CHAT.map(([you, agent]) => ({ you, agent })) } }, made };
}

// (Run as a program, by any path to this file: a symlinked one too.)
if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : HERE;
  mkdirSync(out, { recursive: true });
  const { files, made } = build();
  for (const [name, document] of Object.entries(files)) writeFileSync(join(out, name), `${JSON.stringify(document, null, 1)}\n`);
  console.log(`busy: ${made.agents.length} agents, ${made.souls.length} souls, ${made.capabilities.length} capabilities, ${made.schedules.length + made.triggers.length} automations (${made.runs.length} runs), ${made.teams.length} teams, ${made.servers.length} machines → ${out}`);
}
