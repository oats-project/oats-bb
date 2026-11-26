// The instance panel's part of the real run (parts/README.md). The panel adds no act yet: it
// reads. So this part makes the state its fixtures describe, checks that what the plugin answers
// (the row's facts, the soul as spawned, readiness, the recorded events) is what the kernel
// itself says, and keeps what the kernel printed for the plugin's own calls.
//   - a child on its own worktree under the lead part B left (`oats spawn --parent`, on the command
//     line: the plugin's spawn names no parent), with two facts and two questions on its board, set
//     as its own session sets them (`oats instance board`, in its home);
//   - then one commit to its soul in the workspace's member repository: the row's soul has moved;
//   - then a restart, a stop and a start of the child through the plugin, and one more question on
//     its board: its recorded history.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REAL = process.env.REAL ?? "/home/node/real";
const OATS = JSON.parse(readFileSync(join(REAL, "bin", "oats-record.json"), "utf8")).oats;
const CHILD = "panel-worktree-helper";
const LEAD = "redesign-ui-lead";

export default async (run) => {
  const { step, check, show, until, oats, rowOf, rpc, act, recorded, fixtures, OUT } = run;

  step("C panel 1: a child on its own worktree, with a board: the plugin's facts are the kernel's row");
  const task = join(OUT, `task-${CHILD}.md`);
  writeFileSync(task, "Wait for instructions.\n");
  const spawned = oats("spawn", "oats-expert", "--backend", "bb", "--yolo", "--name", CHILD, "--parent", LEAD, "--task-file", task, "--json");
  check(spawned.exit === 0, `oats spawn oats-expert --name ${CHILD} --parent ${LEAD}`, spawned.stdout || spawned.stderr);
  const home = JSON.parse(spawned.stdout).result.home;
  // As the agent's own session does it: in its home, with the session's environment.
  const asInstance = (...args) => spawnSync(OATS, args, { cwd: home, encoding: "utf8", env: { ...process.env, OATS_INSTANCE: CHILD, OATS_INSTANCE_HOME: home } });
  const context = join(OUT, "panel-question-context.txt");
  writeFileSync(context, "Squash or merge the three commits\nI rebased the branch on main and all checks pass.\nI will merge with the method you pick.\nhttps://github.com/oats-project/oats-bb/pull/42\n");
  const board = [
    ["set", "pr", "--label", "Pull request", "--value", "#42", "--link", "https://github.com/oats-project/oats-bb/pull/42"],
    ["set", "tests", "--label", "Tests", "--value", "12", "--unit", "failing"],
    ["set", "tests", "--label", "Tests", "--value", "3", "--unit", "failing"],
    ["ask", "How should I merge the pull request?", "--option", "Squash: one clean commit", "--option", "Merge: keep the three commits", "--context-file", context],
    ["ask", "Which base branch?", "--option", "main: the default", "--option", "release: the 0.1 line"],
  ];
  for (const words of board) {
    const said = asInstance("instance", "board", ...words, "--json");
    check(said.status === 0, `oats instance board ${words[0]} ${words[1]}, run in the agent's home`, said.stdout + said.stderr);
  }
  // At rest with the board's claim: the kernel's row says the agent is there (`running` null, or true
  // from a provider that scans its harness: oats-bb #40) AND bb says its first turn is over
  // (run.atRest, scenario.mjs): `running` alone no longer says that. The row compared below is one
  // read AFTER that, since bb is asked after `oats status` was read.
  const rested = await until(`${CHILD} to read idle with the board's claim in oats status`, () => {
    const now = rowOf(CHILD);
    return now !== undefined && run.atRest(now) && now.waitingOnYou?.producer === "oats.board" ? now : undefined;
  });
  const row = rested === undefined ? rested : (rowOf(CHILD) ?? rested);
  rpc("refresh");
  const answer = act("the panel's facts of the child", "panelInstance", { instance: CHILD });
  const facts = answer?.facts;
  const same = {
    soul: [facts?.soul, row.agent], work: [facts?.work, row.work], branch: [facts?.branch, row.branch], parent: [facts?.parent, row.parentInstance], harness: [facts?.harness, row.harness],
    model: [facts?.model, row.model], modelFrom: [facts?.modelFrom, row.modelFrom], backend: [facts?.backend, row.backend], threadId: [facts?.threadId, row.session?.threadId],
    startedAt: [facts?.startedAt, row.startedAt], createdAt: [facts?.createdAt, row.createdAt], home: [facts?.home, row.home], running: [facts?.running, row.running],
  };
  const differing = Object.entries(same).filter(([, [plugin, kernel]]) => plugin !== (kernel ?? null));
  check(facts !== undefined && differing.length === 0, "every fact the plugin answers is the kernel's own row's", JSON.stringify(differing));
  check(facts?.work === "worktree" && facts.branch === `agents/${CHILD}` && facts.parent === LEAD && facts.backend === "bb", "a child on its own worktree and branch, under its parent, on bb", JSON.stringify(facts));
  check(facts?.drift.soul === null && facts.drift.modules.length === 0, "nothing moved since its spawn");
  check(answer?.agentsRoot === join(run.DEPLOY, "agents") && answer.soul.key === "oats-expert" && answer.soul.description === "OATS expert: answers questions about OATS.", "the agents root, and the soul's key and description from its agent row", JSON.stringify([answer?.agentsRoot, answer?.soul]));
  check(recorded(["status"]).exit === 0, "the plugin read it from its one `oats status`: no other command of the panel's");
  fixtures.keep("panel/status.json", recorded(["status"]).stdout);

  step("C panel 1b: the soul as the child was spawned from it: the plugin's answer is the kernel's inspection");
  const inspected = JSON.parse(oats("inspect", "--home", home, "--json").stdout).result;
  const soul = act("the soul as spawned", "panelSoul", { instance: CHILD })?.soul;
  check(soul?.name === inspected.souls[0].name && soul.commit === inspected.souls[0].commit && soul.modules === inspected.capabilities.length, "the soul's name, the commit it was spawned from and the number of its modules are the kernel's", JSON.stringify([soul?.name, soul?.commit, soul?.modules]));
  check(JSON.stringify(soul?.capabilities.map((capability) => capability.name)) === JSON.stringify(inspected.capabilities.map((capability) => capability.id)), "its capabilities are the ones the kernel resolved", JSON.stringify(soul?.capabilities));
  const inspectCall = recorded(["inspect", "--home"]);
  check(inspectCall.argv.join(" ") === `inspect --home ${home} --json`, "the plugin asked `oats inspect --home <the home the kernel named> --json`", inspectCall.argv.join(" "));
  fixtures.keep("panel/inspect-home.json", inspectCall.stdout);

  step("C panel 2: the soul's repository moves on: the row says moved, and the plugin answers it");
  const git = (...args) => spawnSync("git", ["-c", "user.name=real-run", "-c", "user.email=real-run@example.invalid", ...args], { cwd: join(REAL, "ws"), encoding: "utf8", env: { ...process.env, GIT_AUTHOR_DATE: "2026-01-02T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-02T00:00:00Z" } });
  writeFileSync(join(REAL, "ws", "souls", "oats-expert", "AGENTS.md"), `${readFileSync(join(REAL, "ws", "souls", "oats-expert", "AGENTS.md"), "utf8")}\nAnswer briefly.\n`);
  const committed = [git("add", "-A"), git("commit", "-q", "-m", "oats-expert answers briefly"), git("push", "-q", join(REAL, "src", "oats-real"), "main")];
  check(committed.every((step) => step.status === 0), "one commit to souls/oats-expert in the workspace's member repository", committed.map((step) => step.stderr).join(" "));
  await until(`${CHILD}'s soul to read moved in oats status`, () => (rowOf(CHILD)?.soul?.status === "moved" ? true : undefined));
  rpc("refresh");
  const moved = act("the panel's facts after the soul moved", "panelInstance", { instance: CHILD });
  show("drift", moved?.facts.drift);
  check(moved?.facts.drift.soul === "moved", "the plugin answers the kernel's word for the soul: moved", JSON.stringify(moved?.facts.drift));
  fixtures.keep("panel/status-soul-moved.json", recorded(["status"]).stdout);

  step("C panel 3: readiness of the child's home and of its soul: the plugin's answer is the kernel's");
  for (const [of, args, file] of [["instance", ["readiness", "--home", home, "--policy", "--json"], "panel/readiness-home.json"], ["soul", ["readiness", "--soul", "oats-expert", "--policy", "--json"], "panel/readiness-soul.json"]]) {
    const kernel = JSON.parse(oats(...args).stdout).result;
    const answer = act(`readiness of the ${of}`, "panelReadiness", { instance: CHILD, of });
    check(answer?.summary.ready === kernel.summary.ready && answer.summary.required === kernel.summary.required && answer.summary.fail === kernel.summary.fail, `the ${of}'s summary is the kernel's (ready ${kernel.summary.ready}, ${kernel.summary.required} required)`, JSON.stringify(answer?.summary));
    check(answer?.checks.map((item) => `${item.key} ${item.status} ${item.items.length}`).join(", ") === ["installed", "configured", "member", "providers"].map((key) => `${key} ${kernel.checks[key].status} ${kernel.checks[key].items.length}`).join(", "), `the ${of}'s four checks, their status and their items are the kernel's`, JSON.stringify(answer?.checks.map((item) => [item.key, item.status])));
    check(answer?.policy?.length === Object.keys(kernel.policy).length, `the ${of}'s policy is answered`, JSON.stringify(answer?.policy));
    const call = recorded(args.slice(0, 2));
    check(call.argv.join(" ") === args.join(" "), `the plugin asked \`oats ${args.join(" ")}\``, call.argv.join(" "));
    fixtures.keep(file, call.stdout);
  }

  step("C panel 3b: readiness of the child's home where the kernel cannot run bb: not ready, in the kernel's own words");
  // Not through the plugin: its host runs `oats` with bb's own PATH, where bb always is. The kernel
  // is asked as the plugin asks it, with a PATH that has no bb on it, and its answer is kept for
  // the plugin's parser and screens (test/panel/readiness-kernel.test.ts, the live scenes).
  const withoutBb = (process.env.PATH ?? "").split(":").filter((dir) => !existsSync(join(dir, "bb"))).join(":");
  const notReady = spawnSync(process.execPath, [realpathSync(OATS), "readiness", "--home", home, "--policy", "--json"], { cwd: run.DEPLOY, encoding: "utf8", env: { ...process.env, PATH: withoutBb } });
  const unready = notReady.status === 0 ? JSON.parse(notReady.stdout).result : null;
  const provider = unready?.checks.providers.items[0];
  check(unready?.summary.ready === false && unready.summary.fail === 1 && unready.summary.required === 4, "the kernel answers not ready: 1 of 4 required checks fails", notReady.stdout.slice(0, 300) + notReady.stderr.slice(0, 300));
  check(provider?.status === "fail" && provider.result?.status === "needs-configuration" && provider.result.problems[0]?.code === "E_BACKEND_VERSION", "the session provider's own answer: needs-configuration, E_BACKEND_VERSION", JSON.stringify(provider));
  fixtures.keep("panel/readiness-home-not-ready.json", notReady.stdout);

  step("C panel 4: the child's recorded lifecycle events, after a restart, a stop and a start through the plugin");
  act("restart the child", "restart", { instance: CHILD });
  await until(`${CHILD} to be started again`, () => (rowOf(CHILD)?.running !== false ? true : undefined));
  const plan = act("the child's stop plan", "stopPlan", { instance: CHILD });
  act("stop the child", "stopApply", { instance: CHILD, revision: plan?.revision, key: "panel-stop-5e1f2a3b" });
  await until(`${CHILD} to read stopped`, () => (rowOf(CHILD)?.runtimeState === "stopped" ? true : undefined));
  act("start the child", "start", { instance: CHILD });
  await until(`${CHILD} to be started`, () => (rowOf(CHILD)?.running !== false ? true : undefined));
  const asked = asInstance("instance", "board", "ask", "Which base branch?", "--option", "main: the default", "--option", "release: the 0.1 line", "--json");
  check(asked.status === 0, "oats instance board ask, in the new session", asked.stdout + asked.stderr);
  const kernelEvents = JSON.parse(oats("instance", "events", CHILD, "--home", home, "--limit", "100", "--json").stdout).result;
  const events = act("the child's recorded events", "panelEvents", { instance: CHILD });
  check(events?.count === kernelEvents.count && events.events.map((event) => event.kind).join(" ") === kernelEvents.events.map((event) => event.kind).join(" "), `the plugin answers the kernel's ${kernelEvents.count} rows, in its order: ${kernelEvents.events.map((event) => event.kind).join(" ")}`, JSON.stringify(events?.events.map((event) => event.kind)));
  check(["spawned", "restarted", "stopped", "launched", "waiting"].every((kind) => events?.events.some((event) => event.kind === kind)), "the history holds the spawn, the restart, the stop, the starts and the board's claims");
  check(events?.waitingOnYou?.producer === kernelEvents.waitingOnYou?.producer && events?.waitingClaims.length === kernelEvents.waitingClaims.length, "what is reported of waiting is the kernel's", JSON.stringify([events?.waitingOnYou, kernelEvents.waitingOnYou]));
  const eventsCall = recorded(["instance", "events"]);
  check(eventsCall.argv.join(" ") === `instance events ${CHILD} --home ${home} --limit 100 --json`, "the plugin asked `oats instance events <instance> --home <its home> --limit 100 --json`", eventsCall.argv.join(" "));
  fixtures.keep("panel/events.json", eventsCall.stdout);
  // The roster of the same moment: what the panel's header says of the agent while its activity says this.
  rpc("refresh");
  const withClaim = recorded(["status"]);
  const claimed = JSON.parse(withClaim.stdout).agents.flatMap((group) => group.instances).find((each) => each.instance === CHILD)?.waitingOnYou;
  check(claimed?.since === kernelEvents.waitingOnYou?.since && claimed?.producer === kernelEvents.waitingOnYou?.producer, "at one moment the roster's claim for the agent is the claim its activity names", JSON.stringify([claimed, kernelEvents.waitingOnYou]));
  fixtures.keep("panel/status-board.json", withClaim.stdout);

  // The panel's own screens on the run's real agent, for the image set: the agent's page (where the
  // panel is at a phone's width and for an agent with no bb thread), its Instance tab and its Soul tab.
  // The child waits with a question on its board: the header says so, with since when.
  step("C panel 5: the panel of the real child, as a person sees it");
  const at = (id) => `[data-testid="oats-panel"] [data-testid="${id}"]`;
  const read = (selector) => `(document.querySelector(${JSON.stringify(selector)})?.innerText ?? "").replace(/\\s+/g, " ").trim()`;
  await run.views("real-panel", async ({ page, at: where, shot }) => {
    await page.goto(`/plugins/oats/agent/${CHILD}`);
    const header = await page.until(`(() => { const name = ${read(at("oats-panel-name"))}; const state = ${read(at("oats-panel-state"))}; return name !== "" && /Needs you/.test(state) && document.querySelector(${JSON.stringify(at("oats-panel-work"))}) !== null ? name + " | " + state : ""; })()`, 40);
    check(typeof header === "string" && header.startsWith("Panel worktree helper | ") && /Needs you . (under a minute|\d+ (min|h|d))$/.test(header), `${where}: the panel names the real child in words and says it needs the person, and how long it has waited`, header ?? (await page.evaluate(read('[data-testid="oats-panel"]'))));
    const asks = await page.until(`(() => { const text = ${read(at("oats-panel-waiting"))}; return text.includes("Which base branch?") ? text : ""; })()`, 20);
    check(Boolean(asks), `${where}: and what it asks, as the kernel recorded it`, asks ?? (await page.evaluate(read('[data-testid="oats-panel"]'))));
    await page.until(`document.getAnimations().every((animation) => animation.playState !== "running")`, 5);
    await shot("instance");
    await page.evaluate(`document.querySelector('[data-testid="oats-tab-soul"]').click()`);
    const soul = await page.until(`(() => { const name = ${read(at("oats-panel-soul-name"))}; const body = ${read(at("oats-panel-soul-body"))}; return name !== "" && body !== "" ? name : ""; })()`, 40);
    check(soul === "oats-expert", `${where}: the Soul tab names the soul the real child was spawned from, with its body read`, soul ?? (await page.evaluate(read('[data-testid="oats-panel"]'))));
    await page.until(`document.getAnimations().every((animation) => animation.playState !== "running")`, 5);
    await shot("soul");
  });
};
