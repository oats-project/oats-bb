// bb's public CLI, and nothing else of bb's: every call is one `bb … --json` process against
// one server (BB_SERVER_URL), bounded in time, its stdout read as bb documents it
// (`bb guide json`: one JSON value on success; {"ok": false, "error": {code, message}} and
// a nonzero exit on failure).
import { spawn } from "node:child_process";
import { fail, isObject } from "./errors.mjs";

const CALL_TIMEOUT_MS = 10_000;
const MAX_OUTPUT = 32 * 1024 * 1024;
// bb's own context variables: inside a bb thread they would aim a command at that thread.
const CONTEXT_ENV = ["BB_THREAD_ID", "BB_PROJECT_ID", "BB_ENVIRONMENT_ID", "BB_SERVER_URL"];

/** One CLI call. Resolves, never rejects:
 *  { ok: true, value } | { ok: false, code, message, timedOut?, missing?, refused? }
 *  (`refused`: bb printed its own failure envelope).
 *  `code` is bb's own error code where it gave one (thread_not_found, invalid_request…),
 *  else `error`; `timeout` and `cli_missing` are this module's. */
export function runBb(cli, args, { server, input, timeoutMs = CALL_TIMEOUT_MS, env = process.env, json = true } = {}) {
  return new Promise((resolve) => {
    const childEnv = { ...env };
    for (const name of CONTEXT_ENV) delete childEnv[name];
    if (server) childEnv.BB_SERVER_URL = server;
    let child;
    try { child = spawn(cli, args, { env: childEnv, stdio: ["pipe", "pipe", "pipe"], windowsHide: true }); }
    catch (error) { resolve({ ok: false, code: "cli_missing", missing: true, message: `cannot run ${cli}: ${error.message}` }); return; }
    let stdout = "", stderr = "", size = 0, settled = false, timedOut = false;
    const finish = (answer) => { if (!settled) { settled = true; clearTimeout(timer); resolve(answer); } };
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, Math.max(1, timeoutMs));
    const take = (chunk, into) => {
      size += chunk.length;
      if (size > MAX_OUTPUT) { child.kill("SIGKILL"); return into; }
      return into + chunk;
    };
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout = take(chunk, stdout); });
    child.stderr.on("data", (chunk) => { stderr = take(chunk, stderr); });
    child.stdin.on("error", () => {}); // a bb that exits before reading: its exit code speaks
    child.on("error", (error) => finish(error.code === "ENOENT" || error.code === "EACCES"
      ? { ok: false, code: "cli_missing", missing: true, message: `cannot run ${cli}: ${error.message}` }
      : { ok: false, code: "error", message: `${cli} ${args[0] ?? ""}: ${error.message}` }));
    child.on("close", (status, signal) => {
      if (timedOut) return finish({ ok: false, code: "timeout", timedOut: true, message: `bb ${args.slice(0, 2).join(" ")} did not answer within ${Math.round(timeoutMs / 100) / 10} s` });
      if (size > MAX_OUTPUT) return finish({ ok: false, code: "error", message: `bb ${args.slice(0, 2).join(" ")} wrote more than ${MAX_OUTPUT} bytes` });
      if (!json) {
        return finish(status === 0 ? { ok: true, value: stdout }
          : { ok: false, code: "error", message: firstLine(stderr) || `bb ${args.join(" ")} exited ${status ?? signal}` });
      }
      let doc, parsed = false;
      try { doc = JSON.parse(stdout); parsed = true; } catch { /* reported below, with the exit */ }
      if (status === 0 && parsed) return finish({ ok: true, value: doc });
      if (parsed && isObject(doc) && doc.ok === false && isObject(doc.error) && typeof doc.error.code === "string") {
        return finish({ ok: false, refused: true, code: doc.error.code, message: typeof doc.error.message === "string" ? doc.error.message : doc.error.code });
      }
      finish({ ok: false, code: "error", message: status === 0
        ? `bb ${args.slice(0, 2).join(" ")} answered something that is not JSON`
        : firstLine(stderr) || `bb ${args.slice(0, 2).join(" ")} exited ${status ?? signal}` });
    });
    child.stdin.end(input ?? "");
  });
}

const firstLine = (text) => String(text).split("\n").map((line) => line.trim()).find(Boolean) ?? "";

/** A failed call after which nothing can have happened in bb: the CLI could not be run,
 *  the request never reached a server (the connection was refused), or bb's server
 *  answered no in its own words (a 4xx with bb's error envelope, an invocation bb's CLI
 *  rejected). Everything else is in doubt for a call that changes something: no answer
 *  in time, a CLI that died or wrote something unreadable, a connection that dropped
 *  after the request went out, a server error. */
export function nothingHappened(answer) {
  if (answer.ok) return false;
  if (answer.missing) return true;
  if (!answer.refused) return false;
  if (answer.code === "error") return /ECONNREFUSED|ENOTFOUND|bad port/.test(answer.message);
  return !/^http_5\d\d$/.test(answer.code) && !/^HTTP 5\d\d\b/.test(answer.message);
}

/** bb says the server did not answer (the CLI's fetch failed), as opposed to answering no. */
function isUnreachable(answer) {
  return !answer.ok && (answer.timedOut === true || (answer.code === "error" && /fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|socket hang up|network/i.test(answer.message)));
}

/** The bb commands this provider uses, each against one server, under one deadline.
 *  A failure throws a ProviderError carrying `fallbackCode` (the caller's phase code),
 *  or E_BACKEND_UNREACHABLE when bb's server did not answer; `bb` on the error is the
 *  raw answer for callers that read bb's own code. */
export function bbClient({ cli, server, deadline = Infinity, env = process.env, fallbackCode = "E_SESSION_UNAVAILABLE" }) {
  const remaining = () => Math.min(CALL_TIMEOUT_MS, deadline - Date.now());
  const raw = async (args, options = {}) => {
    const timeoutMs = remaining();
    if (timeoutMs <= 0) return { ok: false, code: "timeout", timedOut: true, message: `no time left for bb ${args.slice(0, 2).join(" ")}` };
    return runBb(cli, args, { server, env, ...options, timeoutMs: Math.min(timeoutMs, options.timeoutMs ?? timeoutMs) });
  };
  const must = async (args, options) => {
    const answer = await raw(args, options);
    if (answer.ok) return answer.value;
    throw refusal(answer, args);
  };
  const refusal = (answer, args) => {
    const what = `bb ${args.slice(0, 2).join(" ")}`;
    const error = answer.missing ? fail("E_BACKEND_NOT_READY", `${answer.message}: install bb-app or set settings.oats.bb.cli`)
      : isUnreachable(answer) ? fail("E_BACKEND_UNREACHABLE", `bb at ${server} does not answer (${what}: ${answer.message})`)
      : fail(fallbackCode, `${what} failed: ${answer.message}`);
    error.bb = answer;
    return error;
  };
  const list = (value, what) => {
    if (!Array.isArray(value)) throw fail(fallbackCode, `${what} answered something that is not a list`);
    return value;
  };
  return {
    server, raw, refusal,
    async version() {
      const answer = await raw(["--version"], { json: false });
      if (!answer.ok) throw refusal(answer, ["--version"]);
      return answer.value.trim();
    },
    async projects() { return list(await must(["project", "list", "--json"]), "bb project list"); },
    async createProject(name, root) {
      const project = await must(["project", "create", "--name", name, "--root", root, "--json"]);
      if (!isObject(project) || typeof project.id !== "string") throw fail(fallbackCode, "bb project create answered no project id");
      return project;
    },
    /** Every unarchived thread of the server, hidden ones included: one read. (Archived
     *  threads are nobody's session; each start archives one, so they only grow.) */
    async threads() { return list(await must(["thread", "list", "--include-hidden", "--json"]), "bb thread list"); },
    /** The thread, or null when bb has none by that id. */
    async thread(id) {
      const answer = await raw(["thread", "show", id, "--json"]);
      if (answer.ok) {
        if (!isObject(answer.value) || !isObject(answer.value.thread)) throw fail(fallbackCode, "bb thread show answered no thread");
        return answer.value.thread;
      }
      if (answer.code === "thread_not_found") return null;
      throw refusal(answer, ["thread", "show"]);
    },
    async interactions(id) { return list(await must(["thread", "interactions", "list", id, "--json"]), "bb thread interactions list"); },
    spawn(args, options) { return raw(["thread", "spawn", ...args, "--json"], options); },
    tell(id, text) { return raw(["thread", "tell", id, "--message-file", "-", "--mode", "auto", "--json"], { input: text }); },
    queueDelete(threadId, messageId) { return raw(["thread", "queue", "delete", threadId, messageId, "--json"]); },
    stop(id) { return raw(["thread", "stop", id, "--json"]); },
    archive(id) { return raw(["thread", "archive", id, "--json"]); },
  };
}
