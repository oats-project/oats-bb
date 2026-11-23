// The tagged provider's part of the real run (parts/README.md), and the LAST part (the files'
// order): what the Stop dialog says of the agent's thread when the bb session provider is a
// RELEASE that archives at stop.
//
// The dialog says two things of the thread, from two facts (app/lifecycle/words.ts): before the
// stop, what a provider of the VERSION the kernel prints does (`stopArchivesThread`: a release
// from 0.4.0 on archives); after it, what bb shows of the thread. Every other part of the run has
// the provider pinned by a COMMIT, as the run's workspace pins it, so the kernel prints a commit
// as its version and the confirmation keeps the sentence that warns ("A message sent in its
// thread starts it again without OATS…"): parts/lifecycle.mjs asserts that case. A release's
// confirmation ("Its thread is archived. To talk to it again, start it.") can only be seen with a
// provider the kernel calls 0.4.0 or later, and no such release exists yet.
//
// So, once every other part has run, this one pins the SAME commit of the provider by a SCRATCH
// TAG, `v0.4.0`, made in the container's own scratch repository (workspace.sh's: nothing is
// published, nothing leaves the container): the workspace's pin becomes `…/oats-bb.git@v0.4.0`,
// `oats sync` takes it, and the kernel then prints "0.4.0" for the capability (a git pin's version
// is its ref without the "v": awebai/oats lib/packages.mjs `versionOf`). The provider's code is
// the run's own, unchanged: the one that does archive at stop. Then, in each view, one agent of
// its own is stopped through the row's menu, and the dialog is read before and after.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { showSidebar } from "../../browser.mjs";
import { click, closed, dialog, openRowMenu, phaseIs, pick } from "../../scenes/lifecycle.mjs";

/** The tag the run gives the provider's commit: the first release that archives at stop (the plugin's threshold, app/lifecycle/words.ts `ARCHIVES_AT_STOP_FROM`). */
const TAG = "v0.4.0";
const ARCHIVED = "Its thread is archived. To talk to it again, start it.";
const WARNS = "A message sent in its thread starts it again without OATS. To talk to it again, use Start.";

export default async (run) => {
  const { step, check, show, note, until, oats, rowOf, rpc, recorded, evidence, views, DEPLOY, OUT } = run;
  const REAL = dirname(DEPLOY);
  const sh = (cwd, command, ...args) => {
    const done = spawnSync(command, args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_DATE: "2026-01-02T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-02T00:00:00Z" } });
    return { exit: done.status, stdout: (done.stdout ?? "").trim(), stderr: (done.stderr ?? "").trim() };
  };
  const versionNow = () => {
    const shown = oats("capabilities", "show", "oats.bb", "--json");
    try {
      const version = JSON.parse(shown.stdout).result?.version;
      return typeof version === "string" ? version : null;
    } catch {
      return null; // no JSON printed: the check that reads this says what was
    }
  };

  // ---- the provider, pinned by a scratch tag on the commit the run has had all along
  step(`C tagged: the provider pinned by a scratch tag (${TAG}) on the same commit: the kernel calls it a release`);
  const before = versionNow();
  check(typeof before === "string" && /^[0-9a-f]{40}$/.test(before), "until now the kernel printed the provider's version as the commit the run pins", JSON.stringify(before));
  const provider = join(REAL, "provider");
  const commit = sh(provider, "git", "rev-parse", "HEAD").stdout;
  check(commit === before, "that commit is the head of the container's scratch provider repository", `${commit} / ${before}`);
  const bare = join(REAL, "oats-bb.git");
  const tagged = sh(provider, "git", "tag", "-f", TAG, "HEAD");
  const pushed = sh(provider, "git", "push", "-q", "-f", bare, `refs/tags/${TAG}`);
  check(tagged.exit === 0 && pushed.exit === 0 && sh(bare, "git", "rev-parse", `${TAG}^{commit}`).stdout === commit, `the scratch repository has the tag ${TAG} on that commit (made here, in the container: nothing is published)`, tagged.stderr || pushed.stderr);
  // The workspace's pin: the same repository, by the tag.
  const workspace = join(REAL, "ws");
  const manifest = join(workspace, "oats-workspace.yaml");
  const pinned = readFileSync(manifest, "utf8");
  const pin = /^( {2}oats\.bb: git:file:\/\/.+\/oats-bb\.git@)(\S+)$/m.exec(pinned);
  check(pin !== null && pin[2] === commit, "the run's workspace pins the provider by that commit (workspace.sh)", pin?.[0] ?? pinned.slice(0, 400));
  if (pin === null) return;
  writeFileSync(manifest, pinned.replace(pin[0], `${pin[1]}${TAG}`));
  const committed = sh(workspace, "git", "-c", "user.name=real-run", "-c", "user.email=real-run@example.invalid", "commit", "-q", "-am", `the provider pinned by a scratch tag (${TAG}, the same commit)`);
  const sent = sh(workspace, "git", "push", "-q", join(REAL, "src", "oats-real"), "main");
  check(committed.exit === 0 && sent.exit === 0, `the workspace pins it by the tag: oats.bb: …/oats-bb.git@${TAG}`, committed.stderr || sent.stderr);
  const synced = oats("sync", "--dir", DEPLOY);
  check(synced.exit === 0, "oats sync takes the workspace's new pin into the deployment", (synced.stdout + synced.stderr).slice(-500));
  show("oats sync", synced.stdout.split("\n").find((line) => /oats\.bb/.test(line)) ?? synced.stdout.slice(0, 300));
  const after = await until("the kernel to print the provider's version as the tag's", () => (versionNow() === TAG.slice(1) ? versionNow() : undefined), 60);
  check(after === TAG.slice(1), `oats capabilities show oats.bb --json now prints the version "${TAG.slice(1)}": the same code, called a release`, JSON.stringify(versionNow()));
  note(`the bb session provider is pinned by the scratch tag ${TAG} from here on: the kernel prints its version as "${after}", and the Stop dialog's confirmation says the thread is archived`);
  rpc("refresh");

  // ---- in each view: one agent, stopped through its row's menu
  let view = 0;
  await views("real-tagged", async ({ page, at, viewport, shot }) => {
    view += 1;
    const name = `tagged-${view}-helper`;
    const called = run.nameOf(name); // the instance name as the plugin draws it (scenario.mjs)
    step(`C tagged ${view}: ${name}, at ${at}: stopped through the dialog, under a provider the kernel calls ${after}`);
    const file = join(OUT, `task-${name}.md`);
    writeFileSync(file, "Wait for instructions.\n");
    const made = oats("spawn", "oats-expert", "--backend", "bb", "--yolo", "--name", name, "--task-file", file, "--json");
    check(made.exit === 0, `oats spawn oats-expert --name ${name}`, made.stdout.slice(0, 400) || made.stderr.slice(0, 400));
    const idle = await until(`${name} to be there and idle in oats status`, () => {
      const row = rowOf(name);
      return row?.session?.threadId && run.atRest(row) ? row : undefined;
    }, 120);
    const threadId = idle?.session?.threadId;
    rpc("refresh");
    await page.goto("/");
    await showSidebar(page, viewport);
    const drawn = await page.until(`document.querySelector('[data-testid="oats-agent-row"][data-sidebar-thread-id="${threadId}"]') !== null`, 60);
    check(Boolean(drawn), `${at} ${called} has a row in the sidebar`, String(threadId));
    check(await openRowMenu(page, viewport, threadId), `${at} its row's menu opens`);
    check(await pick(page, "Stop agent (OATS)"), `${at} Stop agent (OATS) is pressed`);
    await page.until(phaseIs("ready"), 60);
    let said = await dialog(page);
    check(said.title === `Stop ${called}?` && said.about === name, `${at} the Stop dialog is for ${name}`, JSON.stringify(said));
    // Before the stop: what a provider of the version the kernel prints does. The plan the dialog drew carries that version.
    const plan = recorded(["instance", "stop", name], ["--plan"]);
    check(JSON.parse(plan.stdout).ok === true, "the plugin asked the kernel for the stop's plan", plan.stdout.slice(0, 300));
    check(said.body.includes(ARCHIVED) && !said.body.includes(WARNS), `${at} BEFORE the stop the confirmation says "${ARCHIVED}", and not the warning of a provider that leaves the thread open`, said.body);
    await shot("stop-before");
    await page.evaluate(click("oats-confirm-act"));
    await page.until(phaseIs("done"), 120);
    said = await dialog(page);
    check(said.phase === "done" && said.body.includes(`${called} stopped.`), `${at} the dialog says that it stopped`, JSON.stringify(said));
    check(said.body.includes(ARCHIVED) && !said.body.includes(WARNS), `${at} AFTER the stop the result says the same of the thread: "${ARCHIVED}"`, said.body);
    const stopped = await until(`${name} to read stopped in oats status`, () => {
      const row = rowOf(name);
      return row?.running === false && row.runtimeState === "stopped" ? row : undefined;
    });
    const thread = run.bbThread(threadId);
    check(stopped?.session?.threadId === threadId && thread?.archivedAt != null, "and it is so: oats status has the agent stopped, and bb has its thread archived", JSON.stringify({ row: stopped ? { running: stopped.running, runtimeState: stopped.runtimeState, sessionEnd: stopped.sessionEnd ?? null } : null, thread: thread ? { id: thread.id, status: thread.status, archivedAt: thread.archivedAt } : null }));
    await shot("stop-done");
    await page.evaluate(click("oats-confirm-close"));
    check(Boolean(await page.until(closed, 10)), `${at} Close closes the dialog`);
    if (view === 1) evidence.keep("stop-plan-tagged-provider.json", plan.stdout);
    const gone = oats("retire", name, "--json");
    check(gone.exit === 0, `oats retire ${name} (after the part)`, gone.stdout.slice(0, 300) || gone.stderr.slice(0, 300));
  });
};
