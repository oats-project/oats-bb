// What a bb thread means for OATS: contract item 4's table, and one thread per home.
import { resolve } from "node:path";
import { fail, isObject } from "./errors.mjs";
import { loopbackOrigin } from "./settings.mjs";

// bb's thread statuses (bb packages/domain thread-status). bb has no "stopped": a stopped
// thread settles to idle, and the kernel records OATS's own stop.
const TURN_IN_PROGRESS = new Set(["starting", "active", "stopping"]);
const SETTLED = new Set(["pending", "idle"]);

/** The inspect answer for one existing bb thread: only what bb shows, nothing inferred.
 *  A status word this provider does not know is an error, never a guess. */
export function inspectAnswer(thread) {
  const status = thread.status;
  if (TURN_IN_PROGRESS.has(status)) return { present: true, state: "unknown", running: true };
  if (SETTLED.has(status)) return { present: true, state: "unknown", running: null };
  if (status === "error") return { present: true, state: "shell", running: false };
  throw fail("E_SESSION_UNAVAILABLE", `bb reports thread ${thread.id} as ${JSON.stringify(status)}, a status this provider does not know`);
}

export const MISSING = Object.freeze({ present: false, state: "stopped", running: false });

export const isSettled = (thread) => SETTLED.has(thread.status) || thread.status === "error";
export const isLive = (thread) => isObject(thread) && !thread.archivedAt && !thread.deletedAt;

/** The endpoint the kernel recorded, checked: bb's own ids and a loopback server. */
export function readEndpoint(endpoint, code = "E_SESSION_UNAVAILABLE") {
  if (!isObject(endpoint)) throw fail(code, "the recorded endpoint is not an object");
  for (const key of ["server", "projectId", "threadId"]) {
    if (typeof endpoint[key] !== "string" || !endpoint[key]) throw fail(code, `the recorded endpoint has no ${key}`);
  }
  // An id is an argument to bb: it must never read as an option.
  for (const key of ["projectId", "threadId"]) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(endpoint[key])) throw fail(code, `the recorded endpoint's ${key} is not a bb id`);
  }
  return { server: loopbackOrigin(endpoint.server, "server"), projectId: endpoint.projectId, threadId: endpoint.threadId };
}

const samePath = (a, b) => typeof a === "string" && typeof b === "string" && resolve(a) === resolve(b);

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
 *  E_SESSION_UNAVAILABLE when a second live thread runs in the home. */
export function inspectHome({ home, endpoint }, threads) {
  const recorded = threads.find((thread) => isObject(thread) && thread.id === endpoint.threadId && !thread.deletedAt) ?? null;
  const others = liveThreadsOfHome(threads, home, [endpoint.projectId]).filter((thread) => thread.id !== endpoint.threadId);
  if (others.length > 0) {
    throw fail("E_SESSION_UNAVAILABLE", `more than one live bb thread runs in ${home}: the recorded ${endpoint.threadId}${recorded ? "" : " (missing)"} and ${others.map((thread) => thread.id).join(", ")}. One home is one thread: archive the others in bb`,
      { threads: [endpoint.threadId, ...others.map((thread) => thread.id)] });
  }
  if (!recorded) return { ...MISSING };
  return { ...inspectAnswer(recorded), open: openLink(endpoint) };
}
