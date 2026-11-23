// The provider's pi harness against a real OATS kernel (contract r23, A12 to A14): the
// kernel's own spawn, input, inspect, stop and retire of a pi home and of a Claude home on
// bb, with this provider as a package, in the pi contract image (the pinned bb-app, pi,
// Claude Code, the kernel and @awebai/oats-pi from npm, and the two mock model endpoints).
//
// It shows what the contract tests cannot, since they call the provider with no kernel:
// - that the kernel's launch of a pi home is one the provider takes (what it hands as env,
//   pathPrepend and args), and that the home the kernel composed loads its skills in pi;
// - that a failed turn leaves the home present for the kernel (not LOST), and an input
//   recovers it;
// - that a thread in `error` whose process is gone reads LOST, and that `oats session
//   input` to it is the kernel's resume: counted once against the home's resume cap, and
//   then the provider's tell, on which bb starts the harness again in the same thread for
//   one turn. For pi and for Claude.
//
// Not part of `npm test` or `npm run test:contract`: it needs the network (the
// oats.framework package the workspace pins).
//
//   npm run test:kernel:pi
//   OATS_BB_CONTRACT_DOCKER_ARGS   more `docker run` arguments (e.g. "--dns 1.1.1.1")
//   OATS_BB_CONTRACT_KEEP=1        keep the container
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { after, before, test } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BB_VERSION, repo, rig, sleep, waitFor } from "../rig.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const RUN = "/home/node/pi-kernel-run";
const name = `oats-bb-pi-kernel-run-${process.pid}`;
const SETTINGS = { version: BB_VERSION, trust: "container", dataDir: "/home/node/bbdata" };
const box = rig({
  name,
  image: `oats-bb-contract-pi:${BB_VERSION}`,
  dockerfileDir: resolve(here, "../pi"),
  runArgs: (process.env.OATS_BB_CONTRACT_DOCKER_ARGS ?? "").split(/\s+/).filter(Boolean),
  settings: SETTINGS,
  mock: ["mock-openai.mjs", "mock-anthropic.mjs"],
  bbEnv: { ANTHROPIC_BASE_URL: "http://127.0.0.1:9999", ANTHROPIC_API_KEY: "dummy-not-a-real-key" },
  ready: async () => (await box.provider("check", { home: null, soul: null, launch: { harness: "pi", yolo: true, args: [] } })).result?.status === "ready",
});
const { sh, bbJson, threadStatus } = box;
const oats = (line, options) => sh(`cd ${RUN}/deploy && oats ${line}`, options);
const json = async (text) => JSON.parse(await text);
const homeOf = (soul, instance) => `${RUN}/deploy/agents/${soul}/instances/${instance}`;
const idle = (id) => waitFor(`${id} to be idle`, async () => (await threadStatus(id)) === "idle", { timeoutMs: 120_000 });

/** What each harness's mock saw: the turns a person's message opened. */
const HARNESS = {
  pi: {
    soul: "piworker", providerId: "pi", process: "pi", failFile: "pi-mock-error",
    turns: async () => (await sh("cat pi-mock-requests.jsonl 2>/dev/null || true")).split("\n").filter(Boolean).map((line) => JSON.parse(line)).filter((request) => request.url.includes("chat/completions") && request.tools.length > 0),
    opened: (request, marker) => request.lastRole === "user" && request.lastText.includes(marker),
    sawSkill: async (since, skill) => (await HARNESS.pi.turns()).slice(since).some((request) => request.sys.includes(skill)),
  },
  claude: {
    soul: "claudeworker", providerId: "claude-code", process: "claude", failFile: "mock-error",
    turns: async () => (await box.requests()).filter((request) => request.url.startsWith("/v1/messages") && !request.url.includes("count_tokens") && request.tools.length > 0),
    opened: (request, marker) => request.lastText.includes(marker),
    sawSkill: null,
  },
};
/** The kernel's count of the home's resumes in this boot (its own file, read for the test only). */
const resumeCount = async (home) => Number((await sh(`node -e 'const fs=require("fs"),dir=process.env.HOME+"/.oats/session-resume/provider-resumes";let n=0;try{for(const f of fs.readdirSync(dir)){if(!f.endsWith(".json"))continue;const d=JSON.parse(fs.readFileSync(dir+"/"+f,"utf8"));if(d.home===process.argv[1])n+=d.resumes.length}}catch{}console.log(n)' ${home}`)).trim());
/** The names of the processes that carry the thread's id (bb's BB_THREAD_ID). */
const carriers = async (threadId) => (await sh(`for p in /proc/[0-9]*; do if tr '\\0' '\\n' < $p/environ 2>/dev/null | grep -qx 'BB_THREAD_ID=${threadId}'; then cat $p/comm; fi; done 2>/dev/null || true`)).split("\n").filter(Boolean);
const processesIn = async (home) => Number((await sh(`for p in /proc/[0-9]*; do readlink $p/cwd 2>/dev/null; done | grep -c '^${home}' || true`)).trim());

before(async () => {
  await box.start();
  await sh(`mkdir -p ${RUN}/provider`);
  execFileSync("sh", ["-c", `tar -c -C "$1" --exclude ./.git --exclude ./plugin --exclude ./node_modules . | docker exec -i "$2" tar -x -C ${RUN}/provider`, "sh", repo, name], { stdio: ["ignore", "ignore", "inherit"] });
  console.log(await sh(`sh ${RUN}/provider/test/contract/kernel/pi-setup.sh 2>&1 | grep -v '^npm notice' | tail -4`));
  await sh("echo 'PI-KERNEL-RUN say hi.' > task.md");
}, { timeout: 1_500_000 });
after(() => box.stop());

for (const harness of ["pi", "claude"]) {
  const { soul, providerId, failFile, turns, opened, sawSkill } = HARNESS[harness];
  const instance = `${harness}-a`;
  const landed = async (marker) => (await turns()).filter((request) => opened(request, marker)).length;
  /** `oats session input` with the text in a file, as the wake broker and a person send one. → the kernel's JSON answer. */
  const input = async (home, text) => {
    await sh("cat > input.txt", { input: text });
    return JSON.parse(await sh(`cd ${RUN}/deploy && oats session input --home ${home} --text-file ~/input.txt --json`, { ok: false }));
  };
  const inspect = async (home) => (await json(oats(`session inspect --home ${home} --json`))).result;

  test(`a ${harness} home under the kernel: spawned on bb, told, a failed turn, a lost session resumed by an input and counted once, stopped (its thread archived, and again by a second stop) and retired`, async () => {
    const since = (await turns()).length;
    const spawned = await oats(`spawn ${soul} --name ${instance} --backend bb --task-file ~/task.md 2>&1`);
    assert.match(spawned, new RegExp(`Spawned ${instance} .* bb session`), spawned);
    const home = homeOf(soul, instance);
    const first = await inspect(home);
    assert.deepEqual([first.backend, first.present, first.session.provider], ["bb", true, "oats.bb"]);
    const { threadId, projectId } = first.session.endpoint;
    assert.equal((await bbJson(`thread show ${threadId}`)).thread.providerId, providerId);
    await waitFor("the first turn", async () => (await turns()).length > since, { timeoutMs: 120_000 });
    await idle(threadId);
    if (harness === "pi") {
      // The home as the kernel composed it: its skills reach pi through @awebai/oats-pi and
      // OATS_INSTANCE_HOME, which the provider put into the project's env, with two others.
      assert.equal(await sawSkill(since, "oats-operate"), true, "the home's composed skills are in pi's system prompt");
      assert.deepEqual((await bbJson(`machine env list --project ${projectId}`)).variables.map((variable) => variable.name).sort(), ["OATS_INSTANCE", "OATS_INSTANCE_HOME", "PATH"]);
      assert.equal((await sh(`ls -a ${home}/.claude 2>/dev/null | grep -c settings.local.json || true`)).trim(), "0", "nothing of Claude's was written by the provider");
    }

    // An input, through the kernel: one turn.
    const told = await input(home, `MARK-${harness}-TOLD`);
    assert.equal(told.ok, true, JSON.stringify(told));
    assert.equal(told.result.submitted, true);
    await waitFor("the told turn", async () => (await landed(`MARK-${harness}-TOLD`)) === 1, { timeoutMs: 90_000 });
    await idle(threadId);

    // A command the agent starts and leaves running, outside the home: it inherits bb's
    // BB_THREAD_ID, and is not the thread's harness.
    await sh(`cat > ${harness === "pi" ? "pi-mock-next-cmd" : "mock-next-cmd"}`, { input: "cd / && setsid nohup sleep 900 >/dev/null 2>&1 & echo started" });
    assert.equal((await input(home, `MARK-${harness}-STRAY`)).ok, true);
    await waitFor("the stray command", async () => (await carriers(threadId)).includes("sleep"), { timeoutMs: 90_000 });
    await idle(threadId);

    // A failed turn: bb says error, the agent's process is still loaded, and the kernel
    // reads the home as present (never LOST); an input recovers it, and no resume is counted.
    await sh(`touch ${failFile}`);
    assert.equal((await input(home, `MARK-${harness}-FAILS`)).ok, true);
    await waitFor("the thread to be in error", async () => (await threadStatus(threadId)) === "error", { timeoutMs: 60_000 });
    assert.ok((await carriers(threadId)).includes(HARNESS[harness].process));
    assert.equal((await inspect(home)).present, true);
    await sh(`rm ${failFile}`);
    const recovered = await input(home, `MARK-${harness}-RECOVERED`);
    assert.equal(recovered.ok, true, JSON.stringify(recovered));
    await waitFor("the recovering turn", async () => (await landed(`MARK-${harness}-RECOVERED`)) === 1, { timeoutMs: 90_000 });
    await idle(threadId);
    assert.equal(await resumeCount(home), 0, "an input to a present session is no resume");

    // The other error: a failed turn, and then the agent's process is gone (the thread
    // stopped in bb, not by OATS). bb still says error; the kernel reads the home LOST. An
    // input to it is the kernel's resume: counted once, then the provider's tell, on which
    // bb starts the harness again in the same thread and runs one turn.
    await sh(`touch ${failFile}`);
    assert.equal((await input(home, `MARK-${harness}-FAILS-AGAIN`)).ok, true);
    await waitFor("the thread to be in error again", async () => (await threadStatus(threadId)) === "error", { timeoutMs: 60_000 });
    await sh(`bb thread stop ${threadId} --json >/dev/null`);
    await waitFor("no harness of the thread", async () => !(await carriers(threadId)).includes(HARNESS[harness].process), { timeoutMs: 20_000 });
    // The stray command is still there, with the thread's id: alone, it does not keep the home present.
    assert.ok((await carriers(threadId)).includes("sleep"), "the stray command is still there");
    await waitFor("no process in the home", async () => (await processesIn(home)) === 0, { timeoutMs: 20_000 });
    await sh(`rm ${failFile}`);
    assert.equal(await threadStatus(threadId), "error");
    const lost = await inspect(home);
    assert.equal(lost.present, false, JSON.stringify(lost));
    const resumed = await input(home, `MARK-${harness}-RESUMED`);
    assert.equal(resumed.ok, true, JSON.stringify(resumed));
    assert.equal(resumed.result.submitted, true);
    await waitFor("the resumed turn", async () => (await landed(`MARK-${harness}-RESUMED`)) === 1, { timeoutMs: 120_000 });
    await idle(threadId);
    assert.equal(await landed(`MARK-${harness}-RESUMED`), 1, "one turn");
    assert.equal(await resumeCount(home), 1, "the kernel counted the resume once");
    const after = await inspect(home);
    assert.deepEqual([after.present, after.session.endpoint.threadId], [true, threadId], "the same thread, present again");
    assert.ok((await carriers(threadId)).includes(HARNESS[harness].process), "bb started the harness again");
    await sh("pkill -f 'sleep 90[0]' || true");

    // The kernel's stop and retire: nothing left in the home, the thread archived.
    // The kernel's stop is a plan, then its apply at that plan's revision.
    const kernelStop = async (key) => {
      const plan = await json(oats(`instance stop ${instance} --plan --json`));
      const revision = plan.planRevision ?? plan.result?.planRevision;
      assert.match(String(revision), /^[0-9a-f]{24}$/, JSON.stringify(plan).slice(0, 300));
      return oats(`instance stop ${instance} --apply --plan-revision ${revision} --idempotency-key ${key} --json 2>&1`);
    };
    const archivedAt = async () => (await bbJson(`thread show ${threadId}`)).thread.archivedAt ?? null;
    await kernelStop(`pi-kernel-run-${instance}`);
    await waitFor("no process in the home after the stop", async () => (await processesIn(home)) === 0, { timeoutMs: 30_000 });
    // The provider's stop archived the thread (contract r24, A15(1)): a message to it in
    // bb, as its composer sends one, is refused by bb and starts nothing.
    assert.notEqual(await archivedAt(), null, "the kernel's stop left the home's thread archived");
    const composer = JSON.parse(await sh(`bb thread tell ${threadId} 'MARK-${harness}-COMPOSER' --json`, { ok: false }));
    assert.equal(composer.ok, false, JSON.stringify(composer));
    const refused = await input(home, `MARK-${harness}-AFTER-STOP`);
    assert.equal(refused.ok, false);
    assert.equal(refused.error.code, "E_SESSION_NOT_RUNNING", "a home OATS stopped is refused before any provider call");

    // A home OATS stopped before oats.bb archived at a stop is in this state: recorded
    // stopped, its thread live in bb (here: unarchived by hand). The kernel's stop of a
    // home it already holds stopped asks the provider once more, by the recorded
    // endpoint, so the same command closes it: `oats instance stop <name>`, run again.
    await sh(`bb thread unarchive ${threadId} --json`);
    assert.equal(await archivedAt(), null);
    // And a thread of a person's own in the home's bb project, opened for other work with
    // bb's own spawn: the stop archives the home's recorded thread and no other.
    // (A first turn's prompt is not always the last message of its model request: it is counted, not searched for.)
    const turnsBefore = (await turns()).length;
    const own = await bbJson(`thread spawn --project ${projectId} --provider ${providerId} --model ${harness === "pi" ? "mock/echo" : "claude-opus-5-5"} --permission-mode full --prompt 'MARK-${harness}-PERSON say hi' --title 'A person own thread'`);
    await waitFor("the person's thread's first turn", async () => (await turns()).length > turnsBefore, { timeoutMs: 120_000 });
    await idle(own.id);
    await kernelStop(`pi-kernel-run-${instance}-again`);
    assert.notEqual(await archivedAt(), null, "a second stop of a home recorded stopped archived its thread");
    const ownNow = (await bbJson(`thread show ${own.id}`)).thread;
    assert.deepEqual([ownNow.status, ownNow.archivedAt ?? null, ownNow.deletedAt ?? null], ["idle", null, null], "a person's own thread in the home's project was archived by oats instance stop");
    assert.ok((await carriers(own.id)).includes(HARNESS[harness].process), "nor was it stopped: the stop is of the recorded thread alone");
    // (The retire below is the home's end: its hook stops and archives every live thread of the home's project.)
    await sh(`bb thread stop ${own.id} --json >/dev/null`);
    await waitFor("no process in the home after the second stop", async () => (await processesIn(home)) === 0, { timeoutMs: 30_000 });
    assert.equal(await landed(`MARK-${harness}-COMPOSER`), 0, "a message in bb to a stopped agent's thread reached the model");
    await oats(`retire ${instance} --force 2>&1`);
    assert.ok((await bbJson("thread list --include-archived --include-hidden")).find((row) => row.id === threadId)?.archivedAt, "the home's thread is archived after the retire");
    assert.deepEqual((await bbJson(`machine env list --project ${projectId}`)).variables, [], "and removed the project's env");
    assert.equal(await landed(`MARK-${harness}-AFTER-STOP`), 0);
  });

  // Contract r32, A17, under the kernel: a retire that keeps the home. The kernel's stop
  // archives the thread and the provider's retire hook then deletes the home's bb
  // environment, from the record the kernel's own launch of the provider left. So the
  // thread, unarchived in bb, takes no message, and nothing starts in the kept home.
  test(`a ${harness} home retired with --keep-dir under the kernel: the home stays, its bb environment is destroyed, and its thread, unarchived in bb, takes no message and starts nothing`, async () => {
    const kept = `${harness}-kept`;
    const since = (await turns()).length;
    const spawned = await oats(`spawn ${soul} --name ${kept} --backend bb --task-file ~/task.md 2>&1`);
    assert.match(spawned, new RegExp(`Spawned ${kept} .* bb session`), spawned);
    const home = homeOf(soul, kept);
    const { threadId } = (await inspect(home)).session.endpoint;
    await waitFor("the first turn", async () => (await turns()).length > since, { timeoutMs: 120_000 });
    await idle(threadId);
    const environment = (await bbJson(`thread show ${threadId}`)).thread.environmentId;
    assert.equal((await bbJson(`environment show ${environment}`)).path, home);
    const retired = await oats(`retire ${kept} --keep-dir --force 2>&1`);
    assert.doesNotMatch(retired, /bb environment was not deleted/, retired);
    assert.equal((await sh(`test -d ${home} && test -e ${home}/TASK.md && echo kept || echo gone`)).trim(), "kept", "--keep-dir keeps the home");
    assert.notEqual((await bbJson(`thread show ${threadId}`)).thread.archivedAt ?? null, null, "the home's thread is archived after the retire");
    await waitFor("bb to have destroyed the home's environment", async () => (await bbJson(`environment show ${environment}`)).status === "destroyed", { timeoutMs: 60_000, everyMs: 500 });
    await waitFor("no process in the kept home", async () => (await processesIn(home)) === 0, { timeoutMs: 30_000 });
    // A person unarchives it in bb and sends a message.
    const turnsBefore = (await turns()).length;
    await sh(`bb thread unarchive ${threadId} --json`);
    const told = JSON.parse(await sh(`bb thread tell ${threadId} 'MARK-${harness}-KEPT a word after the retire' --json`, { ok: false }));
    assert.equal(told.ok, false, JSON.stringify(told));
    assert.equal(told.error.code, "thread_environment_unavailable", JSON.stringify(told));
    await sleep(6_000);
    assert.equal(await landed(`MARK-${harness}-KEPT`), 0, "a retired agent took a message");
    assert.equal((await turns()).length, turnsBefore);
    assert.equal(await processesIn(home), 0, "a harness started in the kept home");
    assert.equal((await carriers(threadId)).length, 0);
  });
}
