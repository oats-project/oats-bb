// What a contract test file needs to drive the provider against the pinned bb in a
// container: the container itself (an image of this directory, the mock model endpoint,
// one bb server), a shell in it, the provider's wire, and a scripted tool call.
//
// bb's API has no login and runs commands, so bb runs only inside the container: no port
// is published and only this repository is mounted, read-only.
import assert from "node:assert/strict";
import { execFile, execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
export const repo = resolve(here, "../..");
export const BB_VERSION = readFileSync(resolve(repo, "bb-version"), "utf8").trim();
export const MODEL = "claude-opus-5-5";
export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

export async function waitFor(what, read, { timeoutMs = 60_000, everyMs = 400 } = {}) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const last = await read();
    if (last) return last;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(everyMs);
  }
}

/** One container of `image` (built from `dockerfileDir` at the pinned bb), named `name`.
 *  `runArgs`: more `docker run` arguments. `entry`: the provider's command in the
 *  container. `settings`: the provider's settings for every call. */
export function rig({ name, image, dockerfileDir, runArgs = [], entry = "/repo/oats-package/capabilities/oats-bb/bin/oats-bb.mjs", settings }) {
  /** Run a shell line in the container. → stdout. `ok: false` tolerates a nonzero exit. */
  function sh(line, { input, ok = true } = {}) {
    return new Promise((done, reject) => {
      const child = spawn("docker", ["exec", "-i", name, "sh", "-c", `cd ~ && ${line}`], { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", reject);
      child.on("close", (status) => (status === 0 || !ok ? done(stdout) : reject(new Error(`in the container, \`${line}\` exited ${status}: ${stderr || stdout}`))));
      child.stdin.end(input ?? "");
    });
  }
  const bbJson = async (args, options) => JSON.parse(await sh(`bb ${args} --json`, options));

  /** One call on the provider's wire, as the kernel makes it: the request on stdin, the
   *  settings in OATS_SETTINGS. → the answer envelope. */
  async function provider(verb, input, { with: extra = {} } = {}) {
    const request = { schemaVersion: 1, wire: "1.3", phase: "session", capability: "oats.bb", provider: "bb", verb, input };
    const stdout = await sh(`OATS_CAPABILITY=oats.bb OATS_BACKEND=bb OATS_SETTINGS='${JSON.stringify({ ...settings, ...extra })}' node ${entry} session ${verb}`, { input: JSON.stringify(request) });
    const answer = JSON.parse(stdout);
    assert.equal(answer.verb, verb);
    return answer;
  }

  /** The capability's hook, as the kernel runs it for a home. → {status, stdout}. */
  async function hook(which, env) {
    const vars = Object.entries(env).map(([key, value]) => `${key}='${value}'`).join(" ");
    const stdout = await sh(`${vars} OATS_SETTINGS='${JSON.stringify(settings)}' node ${entry} ${which}; echo "exit=$?"`);
    const at = stdout.lastIndexOf("exit=");
    return { status: Number(stdout.slice(at + 5).trim()), stdout: stdout.slice(0, at).trim() };
  }

  /** The mock's log of model requests. */
  async function requests() {
    const text = await sh("cat mock-requests.jsonl 2>/dev/null || true");
    return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  }

  /** Arm the mock's next reply: a shell command (a Bash call), or `{tool, input}`. */
  const arm = (call) => sh("cat > mock-next-cmd", { input: typeof call === "string" ? call : JSON.stringify(call) });
  const threadStatus = async (id) => (await bbJson(`thread show ${id}`)).thread.status;
  const pending = async (id) => (await bbJson(`thread interactions list ${id}`)).filter((interaction) => interaction.status === "pending");

  /** One turn of the thread that makes one scripted tool call. Waits until the call was
   *  made and the turn is over, or a person's approval is asked for. → {result, pending}:
   *  what the tool answered (as the model saw it), or the interactions that wait. */
  async function toolCall(threadId, call) {
    const before = (await requests()).length;
    await arm(call);
    await sh(`bb thread tell ${threadId} 'contract: next tool call' >/dev/null`);
    const results = async () => (await requests()).slice(before).filter((request) => request.url.startsWith("/v1/messages") && !request.url.includes("count_tokens") && (request.lastText ?? "").startsWith("[tool_result]"));
    let waiting = [], answered = [];
    await waitFor(`the tool call of ${threadId} to finish or ask`, async () => {
      waiting = await pending(threadId);
      if (waiting.length > 0) return true;
      answered = await results();
      return answered.length > 0 && (await threadStatus(threadId)) !== "active";
    }, { timeoutMs: 120_000, everyMs: 700 });
    if (waiting.length > 0) return { result: null, pending: waiting };
    return { result: answered[answered.length - 1].lastText, pending: [] };
  }

  async function start() {
    execFileSync("docker", ["build", "-q", "--build-arg", `BB_APP_VERSION=${BB_VERSION}`, "-t", image, dockerfileDir], { stdio: ["ignore", "ignore", "inherit"] });
    execFileSync("docker", ["run", "-d", "--name", name, "--init", "--cpus", "2", "--memory", "4g", ...runArgs, "-v", `${repo}:/repo:ro`, image], { stdio: ["ignore", "ignore", "inherit"] });
    await run("docker", ["exec", "-d", name, "sh", "-c", "cd ~ && node /repo/test/contract/mock-anthropic.mjs > mock.out 2>&1"]);
    await run("docker", ["exec", "-d", "-e", "ANTHROPIC_BASE_URL=http://127.0.0.1:9999", "-e", "ANTHROPIC_API_KEY=dummy-not-a-real-key", name, "sh", "-c",
      "cd ~ && bb-app --data-dir ~/bbdata --server-bind-host 127.0.0.1 --no-in-app-updates > bb-app.out 2>&1"]);
    await waitFor("bb to be ready", async () => (await provider("check", { home: null, soul: null })).result?.status === "ready", { timeoutMs: 180_000, everyMs: 1_000 });
  }

  async function stop() {
    if (process.env.OATS_BB_CONTRACT_KEEP) { console.log(`kept container ${name}`); return; }
    await run("docker", ["rm", "-f", name]).catch(() => {});
  }

  /** Wait until a turn of the thread reached the model after the mock's request number
   *  `since` (the count before the launch) and the thread is at rest: its first turn is
   *  over. One thread at a time: the mock's log does not say whose turn a request is. */
  async function firstTurnOver(threadId, since) {
    await waitFor(`the first turn of ${threadId}`, async () => (await requests()).slice(since).some((request) => request.url.startsWith("/v1/messages") && !request.url.includes("count_tokens") && request.tools.length > 0), { timeoutMs: 120_000 });
    await waitFor(`${threadId} to be idle`, async () => (await threadStatus(threadId)) === "idle", { timeoutMs: 120_000 });
  }

  return { sh, bbJson, provider, hook, requests, arm, toolCall, threadStatus, pending, firstTurnOver, start, stop };
}
