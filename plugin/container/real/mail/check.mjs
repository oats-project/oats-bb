// The mail part's checks, inside the client container (inside.sh runs it; README.md): the plugin,
// installed in a real bb, reads the mail of a real agent through the real kernel and the real
// messaging layer.
//   1  the tab "Mail" of the agent's page lists the mail the agent received, newest first
//   2  a press shows one message; the 300 KB one says "Shortened."
//   3  NOTHING IS MARKED READ: the agent's unread count (`aw mail inbox --count-only`) is the same
//      before the plugin read anything and after it read, opened and read again
//   4  every `oats` the plugin ran for the mail is the one argv that marks nothing read
//   5  an agent with no messaging layer has the Mail tab as every agent, and it says "No messaging." (no read)
// No check prints a body: a failing one prints subjects, counts or an argv.
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { launchBrowser, testId, textOf, texts, visible } from "../../browser.mjs";
import { completeLines } from "../../files.mjs";

const OUT = process.env.OUT ?? "/home/node/out";
const REAL = process.env.MAIL_REAL ?? "/home/node/mailreal";
const DEPLOY = join(REAL, "deploy");
const READER = join(DEPLOY, "agents/oats-developer/instances/mail-reader");
const BASE = process.env.BB_URL ?? "http://127.0.0.1:38886";
let failures = 0;
const check = (ok, what, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${what}${ok || detail === "" ? "" : `\n     ${detail}`}`);
  if (!ok) failures += 1;
};
/** The agent's unread mail, as `aw` counts it without acknowledging anything. */
const unread = () => execFileSync("aw", ["mail", "inbox", "--count-only"], { cwd: READER, encoding: "utf8" }).trim().split("\n").pop();
// The wrapper appends one line a call while the plugin runs: read by its complete lines (../../files.mjs).
const mailCalls = () =>
  completeLines(join(REAL, "argv.jsonl")).map((line) => JSON.parse(line)).filter((argv) => argv[0] === "operation");
const inMail = (id) => `${testId("oats-mail")} ${testId(id)}`;
const click = (selector, index = 0) => `document.querySelectorAll(${JSON.stringify(selector)})[${index}].click()`;
const subjects = `JSON.stringify(${texts(inMail("oats-mail-subject"))})`;

// A bb that was never opened shows its first-run guide in place of the app (../../live-ui.mjs): mark it as done.
execFileSync("bb", ["settings", "general", "onboardingCompletedAt", new Date().toISOString()], { stdio: "ignore" });
const before = unread();
console.log(`     unread before: ${before}`);
const browser = await launchBrowser({ chromium: process.env.CHROMIUM ?? "chromium", out: OUT, base: BASE });
try {
  for (const viewport of [{ name: "1280x800", width: 1280, height: 800, mobile: false }, { name: "390x800", width: 390, height: 800, mobile: true }]) {
    const at = viewport.name;
    const page = await browser.page(viewport, { theme: "light" });
    await page.goto("/plugins/oats/agent/mail-reader");
    const tab = await page.until(visible(testId("oats-tab-mail")), 60);
    check(Boolean(tab), `${at} 1 the agent's page has the tab Mail (its roster row gives a messaging id)`, await page.evaluate("document.body.innerText.slice(0, 300)"));
    check(mailCalls().length === (viewport.mobile ? 2 : 0), `${at} no mail is read before the tab is pressed`, JSON.stringify(mailCalls().length));
    await page.evaluate(click(testId("oats-tab-mail")));
    const listed = await page.until(visible(inMail("oats-mail-row")), 200);
    const read = await page.evaluate(subjects);
    check(Boolean(listed) && read === JSON.stringify(["A long report", "Parser ready for a first read"]), `${at} 1 the list: the two messages the agent received, newest first; the one it sent is no row`, read);
    await page.shot(`mail-real-${at}-list`);
    await page.evaluate(click(inMail("oats-mail-row"), 0));
    await page.until(visible(inMail("oats-mail-shortened")), 30);
    const message = await page.evaluate(`JSON.stringify([${textOf(`${inMail("oats-mail-message")} h3`)}, ${textOf(inMail("oats-mail-from"))}, ${textOf(inMail("oats-mail-shortened"))}, document.querySelectorAll(${JSON.stringify(`${inMail("oats-mail-body")} p`)}).length > 100])`);
    check(message === JSON.stringify(["A long report", "mail-writer", "Shortened.", true]), `${at} 2 one message: its subject, the sender's alias first, its lines, and "Shortened." for the 300 KB body`, message);
    await page.shot(`mail-real-${at}-message`);
    await page.evaluate(click(inMail("oats-mail-back")));
    await page.until(visible(inMail("oats-mail-refresh")), 30);
    await page.evaluate(click(inMail("oats-mail-refresh")));
    await page.until(`document.querySelector(${JSON.stringify(inMail("oats-mail-refresh"))})?.disabled === false && JSON.parse(${subjects}).length === 2`, 200);
    check(unread() === before, `${at} 3 NOTHING IS MARKED READ: unread after the list, a message and a Refresh is what it was before (${before})`, unread());
    // an agent with no messaging layer
    await page.goto("/plugins/oats/agent/mail-none");
    const panel = await page.until(visible(testId("oats-tab-mail")), 60);
    await page.evaluate(click(testId("oats-tab-mail")));
    const said = await page.until(`(document.querySelector(${JSON.stringify(testId("oats-panel-no-messaging"))})?.innerText ?? "").trim()`, 30);
    check(Boolean(panel) && said === "No messaging.", `${at} 5 an agent with no messaging layer has the Mail tab as every agent, and it says "No messaging."`, String(said));
  }
  const calls = mailCalls();
  const wanted = JSON.stringify(["operation", "run", "messaging:mail", "--home", READER, "--arg", "limit=50", "--json"]);
  check(calls.length === 4 && calls.every((argv) => JSON.stringify(argv) === wanted), `4 every oats the plugin ran for the mail (${calls.length}: the tab and a Refresh, at each width) is the one argv that marks nothing read`, JSON.stringify(calls));
  check(unread() === before, `3 unread at the end: ${unread()} (before: ${before})`);
} finally {
  await browser.close();
}
console.log(failures === 0 ? "== mail, real: all checks passed" : `== mail, real: ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
