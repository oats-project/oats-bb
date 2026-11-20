// stop, and the retire hook's archive (contract item 3).
import { isAbsolute } from "node:path";
import { bbClient } from "./bb.mjs";
import { ProviderError, fail, isObject, recode } from "./errors.mjs";
import { everLaunched } from "./local-settings.mjs";
import { loopbackOrigin } from "./settings.mjs";
import { isSettled, liveInHome, readEndpoint } from "./threads.mjs";

const POLL_MS = 300;
// The kernel gives a stop call 20 s plus its graceSeconds (1 to 300): the wait for bb to
// settle is the grace, and the calls around it stay inside the 20 s.
const MAX_GRACE_SECONDS = 300;
const DEFAULT_GRACE_SECONDS = 10;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const failed = (error) => recode("E_SESSION_STOP_FAILED", error);

/** → { stopped: true } once bb shows the thread settled (idle, pending or error) or gone;
 *  E_SESSION_STOP_FAILED when it is still in a turn after the grace.
 *  With no endpoint (the kernel compensating a launch whose answer was lost): stop
 *  whatever live thread runs in the home; `stopped: true` also when there is none. */
export async function stop(input, settings, { deadline = Infinity, env = process.env, now = Date.now } = {}) {
  try {
    if (!isObject(input)) throw fail("E_SESSION_STOP_FAILED", "the stop input is not an object");
    const grace = graceOf(input);
    const until = Math.min(now() + grace * 1000, deadline);
    if (input.endpoint === null || input.endpoint === undefined) {
      if (typeof input.home !== "string" || !isAbsolute(input.home)) throw fail("E_SESSION_STOP_FAILED", "a stop with no endpoint needs the home's absolute path");
      const bb = bbClient({ cli: settings.cli, server: loopbackOrigin(settings.server, "server"), deadline, env, fallbackCode: "E_SESSION_STOP_FAILED" });
      const { live } = await liveInHome(bb, input.home);
      for (const thread of live) await stopThread(bb, thread.id, { until, grace, now });
      return { stopped: true };
    }
    const endpoint = readEndpoint(input.endpoint, "E_SESSION_STOP_FAILED");
    const bb = bbClient({ cli: settings.cli, server: endpoint.server, deadline, env, fallbackCode: "E_SESSION_STOP_FAILED" });
    await stopThread(bb, endpoint.threadId, { until, grace, now });
    return { stopped: true };
  } catch (error) { throw failed(error); }
}

/** The seconds to wait for bb to settle after `bb thread stop`. */
function graceOf(input) {
  return isObject(input) && Number.isFinite(input.graceSeconds) && input.graceSeconds >= 0 ? Math.min(input.graceSeconds, MAX_GRACE_SECONDS) : DEFAULT_GRACE_SECONDS;
}

async function stopThread(bb, threadId, { until, grace, now }) {
  const asked = await bb.stop(threadId);
  if (!asked.ok && asked.code === "thread_not_found") return;
  if (!asked.ok) throw bb.refusal(asked, ["thread", "stop"]);
  let last = null;
  for (;;) {
    const thread = await bb.thread(threadId);
    if (thread === null || thread.deletedAt || isSettled(thread)) return;
    last = thread.status;
    if (now() + POLL_MS >= until) break;
    await sleep(POLL_MS);
  }
  throw fail("E_SESSION_STOP_FAILED", `bb thread ${threadId} is still ${last} ${grace} s after bb thread stop`);
}

/** The retire hook: archive every live thread that runs in the home, after the kernel's
 *  stop. → the hook's final JSON line. It is safe to run twice and after a spawn that
 *  never launched (nothing to archive is a complete cleanup). A bb that does not answer
 *  does not hold the retire: the thread is left, and readiness reports it
 *  (`session-provider-orphaned`) once the home is gone. */
export async function retire(home, readSettings, { deadline, env = process.env } = {}) {
  // The hook runs for every home that has the capability. One the provider never
  // launched (a tmux home) has nothing in bb: bb is not asked, and need not be there.
  if (!everLaunched(home)) return { meta: { retired: false, reason: "nothing-to-delete" } };
  try {
    const settings = readSettings();
    const bb = bbClient({ cli: settings.cli, server: loopbackOrigin(settings.server, "server"), deadline, env });
    const { live } = await liveInHome(bb, home);
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
