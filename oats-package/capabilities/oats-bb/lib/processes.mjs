// Whether a bb thread's harness is still loaded on this host: asked of the processes
// themselves, never taken from bb's word (contract r23, A13(1) and A14).
//
// bb gives a thread's harness process, and everything that harness starts, the variable
// BB_THREAD_ID=<the thread's id> (its own context variable; the catalog pi a bridge worker
// starts to list models has none). The variable alone does not say the harness lives: a
// command the agent started and left running (a dev server, a watcher, a `sleep`) carries
// it too, and outlives a harness that died. Counted, it would keep a thread in `error`
// reading as present for good, and every input to it would then go past the kernel's
// resume cap. So "the thread's harness lives" is: some process of this host carries that
// variable with that id AND is the harness itself, by its name: `pi` for a thread of bb's
// pi provider, `claude` for one of its claude-code provider. Seen at bb-app 0.50.1: pi
// runs as a process named `pi` (it sets its own title: its command line is that one
// word), and Claude Code as `claude` (argv[0] `<dir>/claude`); the name is looked for in
// the process's name and in the first word of its command line, and in the second where
// the first is an interpreter (a harness that is a script and sets no title).
//
// The provider reads this where the operating system shows a process's environment to the
// user that owns it: Linux's /proc. bb's server and this provider run as one user (the
// provider's data directory default rests on the same), so the thread's processes are
// readable; a process of another user is not, and is not counted.
//
// Two questions are asked of the same look. Whether a thread in `error` still has its
// harness (above): any harness-named process that carries the thread's id. And whether a
// thread at rest RUNS in a home (contract r25, A16; the release lane's condition): the
// same process, whose working directory is also that home. There a false "it runs" is the
// dangerous answer (the kernel would take a home stopped with the host for one that came
// back, and send it no resume), so only the home's own harness counts: never a process
// that merely carries the id, and never a harness that works somewhere else.
import { readFileSync, readdirSync, readlinkSync } from "node:fs";
import { basename, join } from "node:path";
import { fail } from "./errors.mjs";
import { BB_PROVIDER } from "./mode.mjs";
import { samePath } from "./threads.mjs";

const VARIABLE = "BB_THREAD_ID=";
/** The harness's process name, by bb's provider id (a thread row's `providerId`). */
const HARNESS_PROCESS = Object.freeze({ [BB_PROVIDER.pi]: "pi", [BB_PROVIDER.claude]: "claude" });
// What a person does where the look cannot be made (macOS: oats-bb#22). It is asked only of a
// thread in `error`, and while the thread stays so the kernel can neither start the home nor
// send to it (it cannot establish whether the home runs). The one route is bb's own: a
// message to the thread in bb starts a turn and brings it back to idle.
const REMEDY = "To get a thread in error back, send it a message in bb itself (bb thread tell <thread id> <text>): bb starts a turn, and the thread is idle again. Until then oats session start and oats session input refuse for this home";

// The programs that run a harness that is a script: then the harness is the second word.
const INTERPRETERS = new Set(["node", "nodejs", "bun", "deno"]);

/** The names a process goes by: its own name, the base name of the first word of its
 *  command line, and of the second where the first is an interpreter (`node <dir>/pi`).
 *  Never another argument: `tail -f pi` is no pi. A file that cannot be read gives none. */
function namesOf(proc, pid, read) {
  const names = new Set();
  try { names.add(read(join(proc, pid, "comm"), "latin1").trim()); } catch { /* ended meanwhile */ }
  try {
    const [program, script] = read(join(proc, pid, "cmdline"), "latin1").split("\0");
    if (program) names.add(basename(program));
    if (script && INTERPRETERS.has(basename(program ?? ""))) names.add(basename(script));
  } catch { /* ended meanwhile */ }
  names.delete("");
  return names;
}

/** For each bb thread that has a live harness-named process on this host, those
 *  processes: Map<thread id, [{names, cwd}]>. `names`: the harness names the process goes
 *  by. `cwd`: its working directory, or null where it cannot be read (a process that ended
 *  meanwhile, or another user's).
 *
 *  A process's name and command line are read first, and its environment only where one of
 *  its names is a harness's: the environment of every other program of this user (which
 *  may hold a secret) is never opened, and never held in memory. Its working directory is
 *  read only where that environment names a thread. `read` and `link` are the file read
 *  and the link read (the tests watch which files they are asked for). Throws
 *  E_SESSION_UNAVAILABLE where processes cannot be looked at (no /proc: not Linux): the
 *  caller then cannot tell, and says so, never guesses. */
export function threadProcesses({ proc = "/proc", read = readFileSync, link = readlinkSync } = {}) {
  let entries;
  try { entries = readdirSync(proc); }
  catch (error) { throw fail("E_SESSION_UNAVAILABLE", `whether a bb thread's agent process is still loaded cannot be read on this host (${proc}: ${error.code ?? error.message}): the provider reads it from Linux's /proc. ${REMEDY}`); }
  const pids = entries.filter((name) => /^[0-9]+$/.test(name));
  // A /proc that lists no process at all is not one.
  if (pids.length === 0) throw fail("E_SESSION_UNAVAILABLE", `whether a bb thread's agent process is still loaded cannot be read on this host (${proc} lists no process). ${REMEDY}`);
  const harnesses = new Set(Object.values(HARNESS_PROCESS));
  const threads = new Map();
  for (const pid of pids) {
    // Not a harness by any of its names: its environment is none of the provider's business.
    const names = new Set([...namesOf(proc, pid, read)].filter((name) => harnesses.has(name)));
    if (names.size === 0) continue;
    let environ;
    // A process that ended meanwhile, a zombie (an empty environment) or another user's.
    try { environ = read(join(proc, pid, "environ"), "latin1"); } catch { continue; }
    let process = null; // made once, for a harness that carries a thread's id
    for (const entry of environ.split("\0")) {
      if (!entry.startsWith(VARIABLE) || entry.length === VARIABLE.length) continue;
      if (process === null) {
        let cwd = null;
        try { cwd = link(join(proc, pid, "cwd")); } catch { /* ended meanwhile, or not ours to read */ }
        process = { names, cwd };
      }
      const id = entry.slice(VARIABLE.length);
      threads.set(id, [...(threads.get(id) ?? []), process]);
    }
  }
  return threads;
}

/** A reader that looks once, and only when asked. One look serves every home of an
 *  inspectMany, and a look that could not be made is not tried again.
 *  - `has(thread)` → whether the harness of that thread (a row of bb's: its `id` and
 *    `providerId`) lives on this host. A thread of a provider this module does not know
 *    the harness of is asked for either name.
 *  - `runsIn(thread, home)` → whether that harness works in the home: one process that is
 *    the thread's harness by its name, carries the thread's id, AND has the home as its
 *    working directory (exactly the home, as bb starts a harness in the thread's
 *    environment). A harness whose working directory cannot be read is not counted.
 *  Both throw E_SESSION_UNAVAILABLE where the processes cannot be looked at. */
export function processLook(options) {
  let threads = null, failure = null;
  /** The thread's own harness processes, by its provider's harness name. */
  const harnessesOf = (thread) => {
    if (failure !== null) throw failure;
    try { threads ??= threadProcesses(options); }
    catch (error) { failure = error; throw error; }
    const wanted = Object.hasOwn(HARNESS_PROCESS, thread.providerId) ? [HARNESS_PROCESS[thread.providerId]] : Object.values(HARNESS_PROCESS);
    return (threads.get(thread.id) ?? []).filter((process) => wanted.some((name) => process.names.has(name)));
  };
  return {
    has: (thread) => harnessesOf(thread).length > 0,
    runsIn: (thread, home) => harnessesOf(thread).some((process) => process.cwd !== null && samePath(process.cwd, home)),
  };
}
