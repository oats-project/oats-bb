// Whether a bb thread's agent is still loaded on this host: asked of the processes
// themselves, never taken from bb's word (contract r23, A13(1) and A14).
//
// bb gives a thread's agent process, and everything that agent starts, the variable
// BB_THREAD_ID=<the thread's id> (its own context variable; the catalog pi a bridge worker
// starts to list models has none). So "a process of this thread lives" is: some process
// of this host carries that variable with that id. The provider reads it where the
// operating system shows a process's environment to the user that owns it: Linux's /proc.
// bb's server and this provider run as one user (the provider's data directory default
// rests on the same), so the thread's processes are readable; a process of another user
// is not, and is not counted.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fail } from "./errors.mjs";

const VARIABLE = "BB_THREAD_ID=";
// What a person does where the look cannot be made: it is asked only of a thread in `error`,
// and a message to such a thread in bb starts a turn and brings it back to idle.
const REMEDY = "To get a thread in error back, send it a message in bb (bb thread tell <thread id> <text>): bb starts a turn, and the thread is idle again";

/** The ids of the bb threads that have a live process on this host. Throws
 *  E_SESSION_UNAVAILABLE where processes cannot be looked at (no /proc: not Linux): the
 *  caller then cannot tell, and says so, never guesses. */
export function threadsWithProcess({ proc = "/proc" } = {}) {
  let entries;
  try { entries = readdirSync(proc); }
  catch (error) { throw fail("E_SESSION_UNAVAILABLE", `whether a bb thread's agent process is still loaded cannot be read on this host (${proc}: ${error.code ?? error.message}): the provider reads it from Linux's /proc. ${REMEDY}`); }
  const pids = entries.filter((name) => /^[0-9]+$/.test(name));
  // A /proc that lists no process at all is not one.
  if (pids.length === 0) throw fail("E_SESSION_UNAVAILABLE", `whether a bb thread's agent process is still loaded cannot be read on this host (${proc} lists no process). ${REMEDY}`);
  const ids = new Set();
  for (const pid of pids) {
    let environ;
    // A process that ended meanwhile, a zombie (an empty environment) or another user's.
    try { environ = readFileSync(join(proc, pid, "environ"), "latin1"); } catch { continue; }
    for (const entry of environ.split("\0")) {
      if (entry.startsWith(VARIABLE) && entry.length > VARIABLE.length) ids.add(entry.slice(VARIABLE.length));
    }
  }
  return ids;
}

/** A reader that looks once, and only when asked: `has(threadId)` → whether a process of
 *  that thread lives. One look serves every home of an inspectMany. */
export function processLook(options) {
  let ids = null;
  return { has(threadId) { ids ??= threadsWithProcess(options); return ids.has(threadId); } };
}
