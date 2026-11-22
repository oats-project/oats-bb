// The contract test of the thread's title: what the pinned bb-app does to a thread's title
// by itself, and that the title the provider gives a home's thread (the instance's name as
// words, lib/title.mjs) is the one bb shows, and stays.
//
// bb writes its titles through an AI service (bb cloud for a signed-in person, or bb's
// Codex plugin): this container has neither, so the tests install a plugin that registers
// one (test/contract/title-service/). No credential, no OATS kernel.
//
// Not exercised here: bb has a second source of generated titles, the name a thread's own
// agent gives it (bb's event `thread/name/updated`, source "agent"). bb applies it through
// the same guard as its service's title (only to a thread that has none), read in bb's
// server at this version; the mock model names no thread, so a bb that dropped the guard
// on that path alone would not fail this file.
//
// Run: npm run test:contract (needs docker). Again on every bump of bb-app: the provider
// sets the title once, at the spawn, because bb at this version never replaces one.
import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BB_VERSION, MODEL, rig, waitFor } from "./rig.mjs";

const here = dirname(fileURLToPath(import.meta.url));
// What test/contract/title-service/server.js answers, and where it records what it was asked.
const GENERATED = "A title bb wrote";
const ASKED = "/home/node/title-service-asked.jsonl";

const box = rig({
  name: `oats-bb-contract-title-${process.pid}`,
  image: `oats-bb-contract:${BB_VERSION}`,
  dockerfileDir: here,
  settings: { version: BB_VERSION, trust: "container", dataDir: "/home/node/bbdata" },
});
const { sh, bbJson, provider, requests, restartBb } = box;

async function makeHome(name) {
  const home = `/home/node/homes/${name}`;
  // More than five words: bb asks for no title for a shorter task.
  await sh(`mkdir -p ${home} && chmod 700 ${home} && printf 'TASK-${name} say hi to the person, in one short line.\\n' > ${home}/TASK.md`);
  return home;
}
const taskOf = (name) => `TASK-${name} say hi to the person, in one short line.`;
const launchInput = (home, name, extra = {}) => ({
  home, instance: name, harness: "claude", model: MODEL, yolo: true,
  env: [{ name: "OATS_INSTANCE", value: name, source: "kernel" }, { name: "OATS_INSTANCE_HOME", value: home, source: "kernel" }],
  unset: [], pathPrepend: [], args: [], promptFile: `${home}/TASK.md`, previous: null, ...extra,
});

const started = [];
afterEach(async () => {
  for (const id of started.splice(0)) await sh(`bb thread stop ${id} --json >/dev/null 2>&1 || true`);
});

/** A thread spawned in bb itself, as a person's would be, with `title` or with none. Waits
 *  until its first turn is over. → the thread as the spawn answered it. */
async function spawned(name, title = null) {
  const home = await makeHome(name);
  const project = await bbJson(`project create --name ${name} --root ${home}`);
  const since = (await requests()).length;
  const thread = await bbJson(`thread spawn --project ${project.id} --provider claude-code --model ${MODEL} --environment ${home} --prompt-file ${home}/TASK.md --permission-mode full${title === null ? "" : ` --title '${title}'`}`);
  started.push(thread.id);
  await box.firstTurnOver(thread.id, since);
  return thread;
}
/** One more turn of the thread: a message, sent to the model, and the thread at rest again. */
async function turn(threadId, marker) {
  const since = (await requests()).length;
  await sh(`bb thread tell ${threadId} '${marker}: one more message, of more than five words' >/dev/null`);
  await waitFor(`the turn ${marker} of ${threadId}`, async () => (await requests()).slice(since).some((request) => request.tools.length > 0 && (request.lastText ?? "").includes(marker)), { timeoutMs: 120_000 });
  await waitFor(`${threadId} to be idle`, async () => (await box.threadStatus(threadId)) === "idle", { timeoutMs: 120_000 });
}
const shown = async (threadId) => (await bbJson(`thread show ${threadId}`)).thread;
const titleOf = async (threadId) => (await shown(threadId)).title;
/** The prompts bb sent the title service: one per title it asked for. */
const asked = async () => (await sh(`cat ${ASKED} 2>/dev/null || true`)).split("\n").filter(Boolean).map((line) => JSON.parse(line).prompt);
const titleService = async () => (await bbJson("settings ai-services show")).services.find((service) => service.pluginId === "contract-titles");

/** Install the title service, once, and wait until bb would use it for a thread's title. */
async function withTitleService() {
  if (await titleService()) return;
  // From a copy in the container's home: the repository is mounted read-only.
  await sh("rm -rf ~/title-service && cp -r /repo/test/contract/title-service ~/title-service && bb plugin install ~/title-service --yes --json >/dev/null");
  await waitFor("bb to have the title service ready", async () => (await titleService())?.status?.ready === true, { timeoutMs: 60_000 });
  const use = await bbJson("settings ai-services show");
  assert.deepEqual(use.selections["thread-title"], { mode: "automatic" }, "bb's own default: the first service that is ready");
  assert.deepEqual(use.services.filter((service) => service.status.ready).map((service) => service.pluginId), ["contract-titles"], "bb cloud and Codex are signed out here");
}

before(() => box.start(), { timeout: 900_000 });
after(() => box.stop());

test("bb with no title service ready, as a signed-out bb is: a thread spawned with no title has none, and one spawned with a title keeps it", async () => {
  assert.equal((await sh("bb --version")).trim(), BB_VERSION);
  assert.deepEqual((await bbJson("settings ai-services show")).services.filter((service) => service.status.ready), [], "nothing here writes a title");
  const bare = await spawned("raw-bare");
  assert.equal(bare.title, null);
  const named = await spawned("raw-named", "raw-named");
  assert.equal(named.title, "raw-named");
  await turn(bare.id, "LATER-BARE");
  await turn(named.id, "LATER-NAMED");
  const row = await shown(bare.id);
  // What bb draws for it is the start of its task; that is not a title, and `title` stays null.
  assert.equal(row.title, null);
  assert.equal(row.titleFallback, taskOf("raw-bare"));
  assert.equal(await titleOf(named.id), "raw-named");
});

test("bb with a title service ready writes a title only for a thread that has none, once, at its spawn; a title given at the spawn or by `bb thread update` is never replaced: not by a turn, not by a restart of bb", async () => {
  await withTitleService();
  const before = (await asked()).length;

  // No title at the spawn: bb asks its service for one, by itself, and writes it.
  const bare = await spawned("gen-bare");
  assert.equal(bare.title, null, "the spawn answers before the title is written");
  assert.equal(await waitFor("bb's own title", () => titleOf(bare.id)), GENERATED);
  const first = (await asked()).slice(before);
  assert.equal(first.length, 1);
  assert.ok(first[0].includes(taskOf("gen-bare")), "the title bb asked for is this thread's, from its task");

  // A title at the spawn: bb asks for none, and the title stays.
  const named = await spawned("gen-named", "gen-named");
  assert.equal(named.title, "gen-named");
  assert.equal(await titleOf(named.id), "gen-named");

  // A title set afterwards replaces the one bb wrote.
  assert.equal((await bbJson(`thread update ${bare.id} --title 'Set by update'`)).title, "Set by update");

  // Later turns: bb asks for no other title, and both stay.
  await turn(bare.id, "LATER-GEN-BARE");
  await turn(named.id, "LATER-GEN-NAMED");
  assert.equal(await titleOf(bare.id), "Set by update");
  assert.equal(await titleOf(named.id), "gen-named");

  // A restart of bb, and a turn after it.
  await restartBb();
  assert.equal((await titleService())?.status?.ready, true, "the title service is there again");
  assert.equal(await titleOf(bare.id), "Set by update");
  assert.equal(await titleOf(named.id), "gen-named");
  await turn(named.id, "AFTER-RESTART-NAMED");
  assert.equal(await titleOf(named.id), "gen-named");
  assert.equal((await asked()).length, before + 1, "in all of this bb asked for one title: the one of the thread that had none");

  // What does replace a title is a person's own act (or an agent's, with bb's CLI): the
  // limit the provider documents. bb's guide says it never does this by itself.
  assert.equal((await bbJson(`thread regenerate-title ${named.id}`)).title, GENERATED);
  assert.equal(await titleOf(named.id), GENERATED);
  assert.equal((await asked()).length, before + 2);
});

test("a launched OATS thread is titled with the instance's name as words, and stays so: after its first turn, a later turn, a restart of bb and, as a new thread, after a restart of the instance; the project keeps the name", async () => {
  // With bb able to write titles of its own, as a signed-in person's bb is.
  await withTitleService();
  const before = (await asked()).length;
  const name = "title-contract--developer-2";
  const words = "Title contract developer 2";
  const home = await makeHome(name);
  const since = (await requests()).length;
  const answer = await provider("launch", launchInput(home, name));
  assert.equal(answer.ok, true, JSON.stringify(answer));
  const { endpoint } = answer.result;
  started.push(endpoint.threadId);
  assert.equal(await titleOf(endpoint.threadId), words, "from the spawn on");
  const project = (await bbJson("project list")).find((candidate) => candidate.id === endpoint.projectId);
  assert.equal(project.name, name, "the project's name is the instance's name: it identifies the home");

  await box.firstTurnOver(endpoint.threadId, since);
  assert.equal(await titleOf(endpoint.threadId), words, "after its first turn");
  // A later turn, sent as the kernel sends one.
  const sinceInput = (await requests()).length;
  const input = await provider("input", { home, endpoint, text: "LATER-OATS: one more message, of more than five words" });
  assert.equal(input.ok, true, JSON.stringify(input));
  await waitFor("the input's turn", async () => (await requests()).slice(sinceInput).some((request) => request.tools.length > 0 && (request.lastText ?? "").includes("LATER-OATS")), { timeoutMs: 120_000 });
  await waitFor("the thread to be idle", async () => (await box.threadStatus(endpoint.threadId)) === "idle", { timeoutMs: 120_000 });
  assert.equal(await titleOf(endpoint.threadId), words, "after a later turn");
  assert.equal((await bbJson("thread list --include-hidden")).find((row) => row.id === endpoint.threadId).title, words, "and in the list bb's sidebar draws");

  await restartBb();
  assert.equal(await titleOf(endpoint.threadId), words, "after a restart of bb");

  // A restart of the instance: the kernel stops the home's thread, then launches again
  // with the previous endpoint. The new thread is titled the same way; the old one keeps
  // its title, archived.
  const stopped = await provider("stop", { home, endpoint, graceSeconds: 30 });
  assert.equal(stopped.ok, true, JSON.stringify(stopped));
  const sinceRestart = (await requests()).length;
  const again = await provider("launch", launchInput(home, name, { previous: endpoint }));
  assert.equal(again.ok, true, JSON.stringify(again));
  const next = again.result.endpoint;
  started.push(next.threadId);
  assert.notEqual(next.threadId, endpoint.threadId);
  assert.equal(next.projectId, endpoint.projectId);
  assert.equal(await titleOf(next.threadId), words);
  await box.firstTurnOver(next.threadId, sinceRestart);
  assert.equal(await titleOf(next.threadId), words, "after the new thread's first turn");
  const old = await shown(endpoint.threadId);
  assert.notEqual(old.archivedAt, null);
  assert.equal(old.title, words);
  assert.equal((await asked()).length, before, "bb asked its title service for nothing: both threads had their title from the spawn");
});
