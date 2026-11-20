// stop, and the retire hook's archive (contract item 3).
import { isAbsolute } from "node:path";
import { bbClient } from "./bb.mjs";
import { ProviderError, bounded, fail, isObject, recode } from "./errors.mjs";
import { archivedOf, confirmStop, relistOf, stopArchived } from "./halt.mjs";
import { everLaunched } from "./local-settings.mjs";
import { loopbackOrigin } from "./settings.mjs";
import { liveInHome, readEndpoint } from "./threads.mjs";

// The kernel gives a stop call 20 s plus its graceSeconds (1 to 300): the wait for bb to
// settle is the grace, and the calls around it stay inside the 20 s.
const MAX_GRACE_SECONDS = 300;
const DEFAULT_GRACE_SECONDS = 10;
const ISO_UTC = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d{1,9})?Z$/;

const failed = (error) => recode("E_SESSION_STOP_FAILED", error);

/** The time the kernel's receipt says a launch was sent, in milliseconds, or NaN. Only
 *  the form the kernel writes (toISOString) is a time here, and only a time that exists:
 *  Date.parse alone reads "1" or "May 5" as an old date, and turns 29 February of a common
 *  year into 1 March. Anything else archives nothing. */
export function launchSentOf(value) {
  const match = typeof value === "string" ? ISO_UTC.exec(value) : null;
  if (match === null) return NaN;
  const at = Date.parse(value);
  return Number.isFinite(at) && new Date(at).toISOString().slice(0, 19) === match[1] ? at : NaN;
}

/** → { stopped: true } once nothing of the thread can run: bb acknowledged the stop, shows
 *  the thread settled (idle, pending or error) or gone, and holds nothing in line for it
 *  (lib/halt.mjs). E_SESSION_STOP_FAILED otherwise, after the grace.
 *  With no endpoint (the kernel compensating a launch whose answer was lost): stop
 *  whatever live thread runs in the home, archive those made since `launchSent`, and stop
 *  the home's archived threads; `stopped: true` also when there is none. */
export async function stop(input, settings, { deadline = Infinity, env = process.env, now = Date.now, stopCallTimeoutMs } = {}) {
  try {
    if (!isObject(input)) throw fail("E_SESSION_STOP_FAILED", "the stop input is not an object");
    const options = { deadline, grace: graceOf(input), now, stopCallTimeoutMs };
    if (input.endpoint === null || input.endpoint === undefined) {
      if (typeof input.home !== "string" || !isAbsolute(input.home)) throw fail("E_SESSION_STOP_FAILED", "a stop with no endpoint needs the home's absolute path");
      const bb = bbClient({ cli: settings.cli, server: loopbackOrigin(settings.server, "server"), deadline, env, fallbackCode: "E_SESSION_STOP_FAILED" });
      const { projects, live } = await liveInHome(bb, input.home);
      // The home's archived threads too: bb keeps an archived thread's Claude loaded, in
      // the home. All of them: this call is told no thread to count from. Read before
      // anything is changed.
      const archived = await archivedOf(bb, projects.map((project) => project.id));
      // Only a thread made at or after the time the kernel says the failed launch was
      // sent is that launch's, and nobody recorded it: it is archived once stopped, so the
      // next start is not refused for it. An older thread, or any thread when the time is
      // absent or unreadable, may be a person's: stopped, never archived.
      const sentAt = launchSentOf(input.launchSent);
      for (const thread of live) {
        await confirmStop(bb, thread.id, options);
        // Best effort: where bb does not archive it, the thread is still stopped, and the
        // next launch names it.
        if (Number.isFinite(sentAt) && typeof thread.createdAt === "number" && thread.createdAt >= sentAt) await bb.archive(thread.id);
      }
      await stopArchived(bb, archived, relistOf(bb, projects.map((project) => project.id)), options);
      return { stopped: true };
    }
    const endpoint = readEndpoint(input.endpoint, "E_SESSION_STOP_FAILED");
    const bb = bbClient({ cli: settings.cli, server: endpoint.server, deadline, env, fallbackCode: "E_SESSION_STOP_FAILED" });
    // By its id, whatever bb shows of it: a thread archived in bb is stopped like any other.
    await confirmStop(bb, endpoint.threadId, options);
    return { stopped: true };
  } catch (error) { throw failed(error); }
}

/** The seconds to wait for bb to settle after `bb thread stop`. */
export function graceOf(input) {
  return isObject(input) && Number.isFinite(input.graceSeconds) && input.graceSeconds >= 0 ? Math.min(input.graceSeconds, MAX_GRACE_SECONDS) : DEFAULT_GRACE_SECONDS;
}

/** "thr_a, thr_b and 3 more": ids for a warning, inside what the kernel relays. */
function someIds(ids, max = 6) {
  return ids.length <= max ? ids.join(", ") : `${ids.slice(0, max).join(", ")} and ${ids.length - max} more`;
}

// How long the hook waits for one thread to settle: it runs after the kernel's own stop.
const RETIRE_GRACE_SECONDS = 5;

/** The retire hook: stop and archive every live thread that runs in the home, after the
 *  kernel's stop, and stop the home's threads that were archived before. → the hook's
 *  final JSON line. It is safe to run twice and after a spawn that never launched
 *  (nothing to archive is a complete cleanup). A thread is archived only once its stop is
 *  confirmed. A bb that does not answer does not hold the retire: what is left is said in
 *  a warning, and readiness reports it (`session-provider-orphaned`) once the home is gone. */
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
    const { projects, live } = await liveInHome(bb, home);
    const options = { deadline, grace: RETIRE_GRACE_SECONDS };
    const archived = [], left = [];
    for (const thread of live) {
      // Nothing waiting to run and no process left behind, confirmed, before the archive:
      // bb keeps an archived thread's Claude loaded, in the home, unless it was stopped.
      try { await confirmStop(bb, thread.id, options); }
      catch (error) {
        if (!(error instanceof ProviderError)) throw error;
        left.push(thread.id);
        continue;
      }
      const answer = await bb.archive(thread.id);
      (answer.ok || answer.code === "thread_not_found" ? archived : left).push(thread.id);
    }
    // The home's threads archived before now (in bb's UI, or by an earlier start) may
    // hold a process too: all are stopped. The hook is told no thread to count from.
    let unswept = null;
    try { const ids = projects.map((project) => project.id); await stopArchived(bb, await archivedOf(bb, ids), relistOf(bb, ids), options); }
    catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      unswept = error.code;
    }
    const warnings = [];
    if (left.length > 0) warnings.push(`${left.length} bb thread${left.length > 1 ? "s" : ""} of this home could not be stopped and archived (${someIds(left)}): stop and archive ${left.length > 1 ? "them" : "it"} in bb (bb thread stop <id>, bb thread archive <id>)`);
    if (unswept !== null) warnings.push(`the home's archived bb threads could not all be stopped (${unswept}): a Claude process of one may still be loaded; stop them in bb (bb thread list --archived, bb thread stop <id>)`);
    if (warnings.length > 0) return { meta: { archived, ...(left.length > 0 ? { left } : {}), ...(unswept !== null ? { unswept: true } : {}) }, warning: bounded(warnings.join(". ")) };
    if (live.length === 0) return { meta: { retired: false, reason: "nothing-to-delete" } };
    return { meta: { retired: true, archived } };
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    if (!launched) return { meta: { retired: false, reason: "nothing-to-delete", unchecked: true } };
    // The reason by its code: bb's own words are not relayed, and may be long.
    return { meta: { archived: [], unchecked: true }, warning: `the home's bb threads were not archived: oats readiness reports them as session-provider-orphaned once bb answers; stop and archive them in bb. Why bb could not be asked: ${bounded(error.message).slice(0, 260)}` };
  }
}
