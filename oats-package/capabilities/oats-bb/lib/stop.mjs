// stop, and the retire hook's archive (contract item 3).
import { bbClient } from "./bb.mjs";
import { ProviderError, fail, isObject } from "./errors.mjs";
import { loopbackOrigin } from "./settings.mjs";
import { isSettled, liveThreadsOfHome, projectsOfHome, readEndpoint } from "./threads.mjs";

const POLL_MS = 300;
// The kernel gives a stop call 20 s; the wait for bb to settle stays inside it.
export const MAX_GRACE_SECONDS = 12;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const failed = (error) => {
  if (!(error instanceof ProviderError)) throw error;
  return error.code === "E_SESSION_STOP_FAILED" ? error : fail("E_SESSION_STOP_FAILED", error.message, error.details);
};

/** → { stopped: true } once bb shows the thread settled (idle, pending or error) or gone;
 *  E_SESSION_STOP_FAILED when it is still in a turn after the grace. */
export async function stop(input, settings, { deadline = Infinity, env = process.env, now = Date.now } = {}) {
  try {
    if (!isObject(input)) throw fail("E_SESSION_STOP_FAILED", "the stop input is not an object");
    const endpoint = readEndpoint(input.endpoint, "E_SESSION_STOP_FAILED");
    const grace = Number.isFinite(input.graceSeconds) && input.graceSeconds >= 0 ? Math.min(input.graceSeconds, MAX_GRACE_SECONDS) : MAX_GRACE_SECONDS;
    const bb = bbClient({ cli: settings.cli, server: endpoint.server, deadline, env, fallbackCode: "E_SESSION_STOP_FAILED" });
    const asked = await bb.stop(endpoint.threadId);
    if (!asked.ok && asked.code === "thread_not_found") return { stopped: true };
    if (!asked.ok) throw bb.refusal(asked, ["thread", "stop"]);
    const until = Math.min(now() + grace * 1000, deadline);
    let last = null;
    for (;;) {
      const thread = await bb.thread(endpoint.threadId);
      if (thread === null || thread.deletedAt || isSettled(thread)) return { stopped: true };
      last = thread.status;
      if (now() + POLL_MS >= until) break;
      await sleep(POLL_MS);
    }
    throw fail("E_SESSION_STOP_FAILED", `bb thread ${endpoint.threadId} is still ${last} ${grace} s after bb thread stop`);
  } catch (error) { throw failed(error); }
}

/** The retire hook: archive every live thread that runs in the home, after the kernel's
 *  stop. → the hook's final JSON line. It is safe to run twice and after a spawn that
 *  never launched (nothing to archive is a complete cleanup). A bb that does not answer
 *  does not hold the retire: the thread is left, and readiness reports it
 *  (`session-provider-orphaned`) once the home is gone. */
export async function retire(home, settings, { deadline, env = process.env } = {}) {
  let bb;
  try {
    bb = bbClient({ cli: settings.cli, server: loopbackOrigin(settings.server, "server"), deadline, env });
    const [projects, threads] = [await bb.projects(), await bb.threads()];
    const live = liveThreadsOfHome(threads, home, projectsOfHome(projects, home).map((project) => project.id));
    if (live.length === 0) return { meta: { retired: false, reason: "nothing-to-delete" } };
    const archived = [], left = [];
    for (const thread of live) {
      if (!isSettled(thread)) await bb.stop(thread.id);
      const answer = await bb.archive(thread.id);
      (answer.ok || answer.code === "thread_not_found" ? archived : left).push(thread.id);
    }
    if (left.length === 0) return { meta: { retired: true, archived } };
    return { meta: { archived, left }, warning: `bb thread${left.length > 1 ? "s" : ""} ${left.join(", ")} could not be archived: archive ${left.length > 1 ? "them" : "it"} in bb (bb thread archive <id>)` };
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    return { meta: { archived: [], unchecked: true }, warning: `the home's bb threads were not archived (${error.message}): oats readiness reports them as session-provider-orphaned once bb answers; archive them in bb` };
  }
}
