// The provider against a real OATS kernel: the kernel's own spawn, check, inspect and
// retire, with this provider as a package, the pinned bb-app and Claude Code, in a
// container. It shows what the unit and contract tests cannot: that the kernel under test
// SENDS what the provider reads (`trees` and `protected`, in the check's planned launch and
// in the launch), and that a sandboxed launch made by that kernel keeps the agent's tools
// off the kernel's own copy of the home's modules, which the home's hooks run from.
//
// Not part of `npm test` or `npm run test:contract`: it needs a clone of the OATS
// repository, and the network (the kernel's dependencies, the oats.framework package).
//
//   OATS_KERNEL_REPO=<a clone of the OATS repository> OATS_KERNEL_REF=<commit> npm run test:kernel
//   OATS_BB_CONTRACT_DOCKER_ARGS   more `docker run` arguments (e.g. "--dns 1.1.1.1")
//   OATS_BB_CONTRACT_KEEP=1        keep the container
//
// The clone is only read (`git archive`). bb runs only inside the container.
//
// Two deployments are made in it (kernel/setup.sh): one with the provider as it ships, whose
// homes run in bb's full mode; one with a TRIAL package, never pushed, whose session verbs
// take the sandboxed modes, because the shipped command refuses every launch that is not
// full and a sandboxed launch by a real kernel is what is to be seen.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { after, before, test } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BB_VERSION, repo, rig } from "../rig.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const KERNEL_REPO = process.env.OATS_KERNEL_REPO, KERNEL_REF = process.env.OATS_KERNEL_REF;
if (!KERNEL_REPO || !KERNEL_REF) throw new Error("set OATS_KERNEL_REPO (a clone of the OATS repository) and OATS_KERNEL_REF (the commit to run against)");
const KERNEL_OID = execFileSync("git", ["-C", KERNEL_REPO, "rev-parse", "--verify", `${KERNEL_REF}^{commit}`], { encoding: "utf8" }).trim();
const RUN = "/home/node/kernel-run";
const name = `oats-bb-kernel-run-${process.pid}`;
const box = rig({
  name,
  image: `oats-bb-contract-sandbox:${BB_VERSION}`,
  dockerfileDir: resolve(here, "../sandbox"),
  runArgs: ["--security-opt", "seccomp=unconfined", "--security-opt", "apparmor=unconfined", "--security-opt", "systempaths=unconfined",
    ...(process.env.OATS_BB_CONTRACT_DOCKER_ARGS ?? "").split(/\s+/).filter(Boolean)],
  settings: { version: BB_VERSION, trust: "container", dataDir: "/home/node/bbdata" },
});
const { sh, toolCall } = box;
const oats = (deployment, line, options) => sh(`cd ${RUN}/${deployment} && oats ${line}`, options);
const json = async (text) => JSON.parse(await text);
const homeOf = (deployment, soul, instance) => `${RUN}/${deployment}/agents/${soul}/instances/${instance}`;
const settingsOf = (home) => json(sh(`cat ${home}/.claude/settings.local.json`));
const planted = async (...paths) => (await sh(`grep -rls PLANTED ${paths.join(" ")} 2>/dev/null; true`)).split("\n").filter(Boolean);

before(async () => {
  await box.start();
  // The kernel's tree at the commit under test, and this repository's tree as it stands.
  await sh(`mkdir -p ${RUN}/kernel ${RUN}/provider`);
  execFileSync("sh", ["-c", `git -C "$1" archive "$2" | docker exec -i "$3" tar -x -C ${RUN}/kernel`, "sh", KERNEL_REPO, KERNEL_OID, name], { stdio: ["ignore", "ignore", "inherit"] });
  execFileSync("sh", ["-c", `tar -c -C "$1" --exclude ./.git --exclude ./plugin --exclude ./node_modules . | docker exec -i "$2" tar -x -C ${RUN}/provider`, "sh", repo, name], { stdio: ["ignore", "ignore", "inherit"] });
  console.log(await sh(`sh ${RUN}/provider/test/contract/kernel/setup.sh 2>&1 | grep -v '^npm notice' | tail -6`));
  await sh("echo 'KERNEL-RUN say hi.' > task.md");
}, { timeout: 1_500_000 });
after(() => box.stop());

test("the provider as it ships, under the kernel: a spawn launches the home in bb's full mode, and the kernel reads and retires it", async () => {
  const spawned = await oats("shipped", "spawn worker --name ship-a --backend bb --task-file ~/task.md 2>&1");
  assert.match(spawned, /Spawned ship-a .* bb session/);
  const home = homeOf("shipped", "worker", "ship-a");
  // Full mode: the launch environment, and none of the sandbox keys.
  assert.deepEqual(Object.keys(await settingsOf(home)), ["env"]);
  const read = await json(oats("shipped", `session inspect --home ${home} --json`));
  assert.equal(read.ok, true, JSON.stringify(read));
  assert.deepEqual([read.result.backend, read.result.present, read.result.session.provider], ["bb", true, "oats.bb"]);
  const threadId = read.result.session.endpoint.threadId;
  // A launch that is not full is refused by the shipped provider, at the kernel's check, before any home is made.
  const refused = await oats("shipped", "spawn worker --name ship-b --backend bb --no-yolo --task-file ~/task.md 2>&1", { ok: false });
  assert.match(refused, /E_BACKEND_SANDBOXED_MODE/);
  assert.match(refused, /sandboxed modes are not offered/);
  assert.equal((await sh(`test -e ${homeOf("shipped", "worker", "ship-b")} && echo there || echo none`)).trim(), "none");
  await oats("shipped", "retire ship-a --force 2>&1");
  const rows = await json(sh("bb thread list --include-archived --json"));
  assert.ok(rows.find((row) => row.id === threadId)?.archivedAt, "the retire archived the home's thread");
});

test("a sandboxed launch made by the kernel: it sends trees and protected, the rules cover its own module copy, and the agent runs that copy and cannot change it", async () => {
  const spawned = await oats("trial", "spawn worker --name trial-a --backend bb --task-file ~/task.md 2>&1");
  assert.match(spawned, /Spawned trial-a .* bb session/);
  const home = homeOf("trial", "worker", "trial-a"), instances = dirname(home), retirement = `${instances}/.oats-retirement`;

  // What the kernel sent, as the trial kept it: the check before the launch, then the launch.
  const requests = (await sh(`ls ${RUN}/requests`)).split("\n").filter(Boolean);
  assert.deepEqual(requests.slice(0, 2).map((file) => file.replace(/^\d+-/, "")), ["check.json", "launch.json"]);
  const check = await json(sh(`cat ${RUN}/requests/${requests[0]}`)), launch = await json(sh(`cat ${RUN}/requests/${requests[1]}`));
  for (const [what, input] of [["the check's planned launch", check.input.launch], ["the launch", launch.input]]) {
    assert.deepEqual(input.trees, [`${home}/work`], what);
    assert.deepEqual(input.protected, [retirement], what);
    assert.equal(input.yolo, false, what);
  }
  assert.equal(launch.wire, "1.3");

  // The kernel's own copy of the home's modules is inside what it named, and the home's hooks run from it.
  const copy = (await sh(`ls -d ${retirement}/modules/*/*/oats.core`)).trim();
  assert.match(await sh(`cat ${home}/.claude/settings.json`), new RegExp(copy.replaceAll(".", "\\.")));

  // The rules the provider wrote from that launch.
  const settings = await settingsOf(home);
  assert.equal(settings.permissions.blockWritesOutsideWorkingDirectories, true);
  const gitDir = (await sh(`cat ${home}/work/.git`)).trim().replace(/^gitdir: /, "");
  const clone = gitDir.replace(/\/\.git\/worktrees\/.*$/, "");
  for (const path of [`${retirement}`, `${retirement}/**`, `${home}/work/.git`, `${gitDir}/hooks/**`, `${clone}/.git/config`, `${clone}/.git/hooks/**`, `${home}/.oats/**`, `${home}/instance.json`]) {
    assert.ok(settings.permissions.deny.includes(`Edit(/${path})`), path);
  }

  // In the sandbox: the copy is read and run where it is, and cannot be written, renamed
  // away or replaced; the agent's own files are its own.
  const threadId = (await json(oats("trial", `session inspect --home ${home} --json`))).result.session.endpoint.threadId;
  await box.firstTurnOver(threadId, 0);
  const attempt = [
    `head -c 1 ${copy}/oats.json | tr '{' 'R'; /bin/sh -n ${copy}/bin/claude-waiting.sh && echo EXEC-OK; /bin/sh ${copy}/bin/claude-waiting.sh >/dev/null 2>&1; echo RAN`,
    `(echo PLANTED >> ${copy}/bin/claude-waiting.sh) 2>/dev/null; (echo PLANTED > ${copy}/bin/new.sh) 2>/dev/null`,
    `mv ${copy} ${copy}-old 2>/dev/null; mv ${retirement} ${retirement}-old 2>/dev/null`,
    `(echo PLANTED >> ${home}/.oats/planted) 2>/dev/null; (echo PLANTED > ${home}/work/.git) 2>/dev/null; (echo PLANTED >> ${clone}/.git/config) 2>/dev/null`,
    `echo FREE > ${home}/work/note.txt; echo attempted`,
  ].join("\n");
  await sh(`cat > ${home}/work/attempt.sh`, { input: attempt });
  const bash = await toolCall(threadId, `sh ${home}/work/attempt.sh`);
  assert.deepEqual(bash.pending, []);
  assert.match(bash.result, /REXEC-OK/, "read and run from inside the sandbox");
  assert.match(bash.result, /RAN/);
  assert.match(bash.result, /attempted/);
  assert.deepEqual(await planted(retirement, `${home}/.oats`, `${home}/work/.git`, `${clone}/.git/config`), []);
  assert.equal((await sh(`ls -d ${copy}-old ${retirement}-old 2>/dev/null | wc -l`)).trim(), "0");
  assert.equal((await sh(`cat ${home}/work/note.txt`)).trim(), "FREE");
  const write = await toolCall(threadId, { tool: "Write", input: { file_path: `${copy}/bin/claude-waiting.sh`, content: "PLANTED\n" } });
  assert.match(write.result, /denied by your permission settings/);
  assert.deepEqual(await planted(retirement), []);

  // The kernel still reads the home (its check of the copy it runs passes), and retires it.
  const read = await json(oats("trial", `session inspect --home ${home} --json`));
  assert.deepEqual([read.ok, read.result.present], [true, true], JSON.stringify(read));
  await oats("trial", "retire trial-a --force 2>&1");
  assert.ok((await json(sh("bb thread list --include-archived --json"))).find((row) => row.id === threadId)?.archivedAt);
});
