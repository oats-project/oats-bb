// The instance panel's part of the real run (parts/README.md). The panel adds no act yet: it
// reads. So this part makes the state its fixtures describe, checks that what the plugin answers
// for one instance is what the kernel's own row says, and keeps what the kernel printed.
//   - a child on its own worktree under the lead part B left (`oats spawn --parent`, on the command
//     line: the plugin's spawn names no parent), with two facts and two questions on its board, set
//     as its own session sets them (`oats instance board`, in its home);
//   - then one commit to its soul in the workspace's member repository: the row's soul has moved.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
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
  const row = await until(`${CHILD} to read idle with the board's claim in oats status`, () => {
    const now = rowOf(CHILD);
    return now?.running === null && now.waitingOnYou?.producer === "oats.board" ? now : undefined;
  });
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
};
