// What a bb thread means for OATS: contract item 4's table, and one thread per home.
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fail, isObject, someOf } from "./errors.mjs";
import { loopbackOrigin } from "./settings.mjs";

// bb's thread statuses (bb packages/domain thread-status). bb has no "stopped": a stopped
// thread settles to idle, and the kernel records OATS's own stop.
const TURN_IN_PROGRESS = new Set(["starting", "active", "stopping"]);
const SETTLED = new Set(["pending", "idle"]);

// What a home with no session reads as: a thread that is gone, and a lost one.
const MISSING = Object.freeze({ present: false, state: "stopped", running: false });
// A thread at rest. With work bb holds in line (a turn its concurrency limit has not
// started yet) it is busy: the turn starts by itself when a slot frees.
const atRest = (thread) => ({ present: true, state: "unknown", running: hasQueuedWork(thread) ? true : null });

/** The inspect answer for one existing bb thread: only what bb shows, nothing inferred.
 *  A status word this provider does not know is an error, never a guess.
 *
 *  `error` (contract r23, A13(1) and A14) is bb's word for a thread whose last turn failed, and
 *  bb says the same of one whose agent is gone. Seen at bb-app 0.50.1, for pi and for
 *  Claude alike: after a turn the model endpoint refused, the thread is `error` while its
 *  agent process is still loaded in the home, and the next tell starts a turn and brings
 *  it back to idle. Read as a lost session, the kernel would resume it beside that
 *  process, and refuses to: the home would be stuck. So which of the two it is is decided
 *  here, at every call, from the processes themselves, never from bb's word alone:
 *  `processes.has(id)` says whether a process of the thread lives on this host
 *  (lib/processes.mjs).
 *  - one lives: the thread is there and at rest, and an input recovers it;
 *  - none: a lost session, as the kernel reads one, which it may resume with an input;
 *  - it cannot be told (the look throws): an error, never either of the two. */
export function inspectAnswer(thread, processes) {
  const status = thread.status;
  if (TURN_IN_PROGRESS.has(status)) return { present: true, state: "unknown", running: true };
  if (SETTLED.has(status)) return atRest(thread);
  if (status === "error") {
    // A turn bb holds in line starts by itself, whatever is loaded now.
    if (hasQueuedWork(thread)) return atRest(thread);
    return processes.has(thread.id) ? atRest(thread) : { ...MISSING };
  }
  throw fail("E_SESSION_UNAVAILABLE", `bb reports thread ${thread.id} as ${JSON.stringify(status)}, a status this provider does not know`);
}

export const isSettled = (thread) => SETTLED.has(thread.status) || thread.status === "error";
/** Whether bb's list row says the thread has work held in line (`queuedWork`, "none" when
 *  there is none). `bb thread show` does not carry the field: only a list row is asked. */
export const hasQueuedWork = (thread) => typeof thread.queuedWork === "string" && thread.queuedWork !== "none";
export const isLive = (thread) => isObject(thread) && !thread.archivedAt && !thread.deletedAt;

/** One of bb's ids (thr_…, proj_…, qmsg_…). An id is an argument to bb: it must never
 *  read as an option. */
export const isBbId = (value) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);

/** The endpoint the kernel recorded, checked: bb's own ids and a loopback server. */
export function readEndpoint(endpoint, code = "E_SESSION_UNAVAILABLE") {
  if (!isObject(endpoint)) throw fail(code, "the recorded endpoint is not an object");
  for (const key of ["server", "projectId", "threadId"]) {
    if (typeof endpoint[key] !== "string" || !endpoint[key]) throw fail(code, `the recorded endpoint has no ${key}`);
  }
  for (const key of ["projectId", "threadId"]) {
    if (!isBbId(endpoint[key])) throw fail(code, `the recorded endpoint's ${key} is not a bb id`);
  }
  return { server: loopbackOrigin(endpoint.server, "server"), projectId: endpoint.projectId, threadId: endpoint.threadId };
}

/** The same directory: the same path, or (where bb recorded the path it resolved) the
 *  same real path. Exactly the home: never a parent, never a directory inside it. */
export function samePath(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (resolve(a) === resolve(b)) return true;
  try { return realpathSync(a) === realpathSync(b); } catch { return false; }
}

/** The bb projects rooted at the home (a local source whose path is the home). */
export function projectsOfHome(projects, home) {
  return projects.filter((project) => isObject(project) && Array.isArray(project.sources)
    && project.sources.some((source) => isObject(source) && samePath(source.path, home)));
}

/** The live (unarchived, undeleted) threads that run in the home: those of the projects
 *  given, and any thread whose environment is the home itself. */
export function liveThreadsOfHome(threads, home, projectIds) {
  const ids = new Set(projectIds);
  return threads.filter((thread) => isLive(thread) && (ids.has(thread.projectId) || samePath(thread.environmentPath, home)));
}

/** What a client may open instead of a terminal. */
export function openLink({ server, projectId, threadId }) {
  return { label: "Open in bb", url: `${server}/projects/${encodeURIComponent(projectId)}/threads/${encodeURIComponent(threadId)}` };
}

/** The inspect answer of one home, from one list of the server's threads. Throws
 *  E_SESSION_UNAVAILABLE when a second live thread runs in the home.
 *  The home's thread is its recorded thread while that is live. Archived (in bb's UI, or
 *  by a retire) it is no longer the home's session: bb refuses every tell to an archived
 *  thread, so it reads as missing, and a start replaces it. */
export function inspectHome({ home, endpoint }, threads, processes) {
  const recorded = threads.find((thread) => isObject(thread) && thread.id === endpoint.threadId && isLive(thread)) ?? null;
  const others = liveThreadsOfHome(threads, home, [endpoint.projectId]).filter((thread) => thread.id !== endpoint.threadId);
  if (others.length > 0) {
    // The remedy and the count first: the list may be long, and a message is cut at 500.
    const ids = others.map((thread) => thread.id);
    const named = someOf(ids);
    throw fail("E_SESSION_UNAVAILABLE", `more than one live bb thread runs in ${home}. One home is one thread: archive the ${ids.length > 1 ? `${ids.length} others` : "other"} in bb. The recorded thread is ${endpoint.threadId}${recorded ? "" : " (missing or archived)"}; the other${ids.length > 1 ? "s" : ""}: ${named}`);
  }
  if (!recorded) return { ...MISSING };
  return { ...inspectAnswer(recorded, processes), open: openLink(endpoint) };
}

/** What runs in a home now: its bb projects, and its live threads. Two reads of bb. */
export async function liveInHome(bb, home) {
  const [allProjects, threads] = [await bb.projects(), await bb.threads()];
  const projects = projectsOfHome(allProjects, home);
  return { projects, live: liveThreadsOfHome(threads, home, projects.map((project) => project.id)) };
}
