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
export async function stop(input, settings, { deadline = Infinity, env = process.env, now = Date.now, stopCallTimeoutMs } = {}) {
  try {
    if (!isObject(input)) throw fail("E_SESSION_STOP_FAILED", "the stop input is not an object");
    const grace = graceOf(input);
    if (input.endpoint === null || input.endpoint === undefined) {
      if (typeof input.home !== "string" || !isAbsolute(input.home)) throw fail("E_SESSION_STOP_FAILED", "a stop with no endpoint needs the home's absolute path");
      const bb = bbClient({ cli: settings.cli, server: loopbackOrigin(settings.server, "server"), deadline, env, fallbackCode: "E_SESSION_STOP_FAILED" });
      const { live } = await liveInHome(bb, input.home);
      for (const thread of live) await stopThread(bb, thread.id, { deadline, grace, now, stopCallTimeoutMs });
      return { stopped: true };
    }
    const endpoint = readEndpoint(input.endpoint, "E_SESSION_STOP_FAILED");
    const bb = bbClient({ cli: settings.cli, server: endpoint.server, deadline, env, fallbackCode: "E_SESSION_STOP_FAILED" });
    await stopThread(bb, endpoint.threadId, { deadline, grace, now, stopCallTimeoutMs });
    return { stopped: true };
  } catch (error) { throw failed(error); }
}

/** The seconds to wait for bb to settle after `bb thread stop`. */
export function graceOf(input) {
  return isObject(input) && Number.isFinite(input.graceSeconds) && input.graceSeconds >= 0 ? Math.min(input.graceSeconds, MAX_GRACE_SECONDS) : DEFAULT_GRACE_SECONDS;
}

async function stopThread(bb, threadId, { deadline, grace, now, stopCallTimeoutMs }) {
  const asked = await bb.stop(threadId, stopCallTimeoutMs === undefined ? {} : { timeoutMs: stopCallTimeoutMs });
  if (!asked.ok && asked.code === "thread_not_found") return;
  // bb's stop may wait for the thread to settle, longer than one bb call gets here: a
  // stop cut off by time has still been asked, and what bb shows next decides.
  if (!asked.ok && !asked.timedOut) throw bb.refusal(asked, ["thread", "stop"]);
  // The grace is the time bb gets to settle after it was asked: finding the thread and
  // the stop call itself take none of it. The command's own deadline still ends the wait.
  const until = Math.min(now() + grace * 1000, deadline);
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
  // The hook runs for every home that has the capability, and is not told the home's
  // backend. The provider's state directory says it launched this home, but the home is
  // its agent's to write and may have been cleaned: its absence proves nothing, so bb is
  // asked either way. What its absence does change: a home the provider may never have
  // launched (a tmux home, perhaps on a host with no bb) gets no warning when bb cannot be
  // asked. Threads left that way are what readiness reports as orphaned.
  const launched = everLaunched(home);
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
    if (!launched) return { meta: { retired: false, reason: "nothing-to-delete", unchecked: true } };
    return { meta: { archived: [], unchecked: true }, warning: `the home's bb threads were not archived (${error.message}): oats readiness reports them as session-provider-orphaned once bb answers; archive them in bb` };
  }
}
