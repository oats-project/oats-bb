// launch: one OATS home becomes one bb thread (contract items 1, 4, 6).
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { bbClient, nothingHappened } from "./bb.mjs";
import { readLaunchEnv, readSandbox, readUnset, withPathPrepend, writeLaunchSettings } from "./local-settings.mjs";
import { harnessRefusal, permissionMode, sandboxRefusal, sandboxedModeRefusal } from "./mode.mjs";
import { InDoubt, ProviderError, fail, isObject } from "./errors.mjs";
import { backendProblems } from "./readiness.mjs";
import { isBbId, isSettled, liveInHome, liveThreadsOfHome, projectsOfHome } from "./threads.mjs";

const BB_PROVIDER = "claude-code";
// After a spawn whose fate is unknown: how often, and how far apart, the home's threads
// are read for the thread it may have made.
const SPAWN_LOOKS = 3;
const SPAWN_LOOK_MS = 1_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function readInput(input) {
  if (!isObject(input)) throw fail("E_SESSION_START_FAILED", "the launch input is not an object");
  const { home, instance, harness, model, promptFile, previous } = input;
  const unsupported = harnessRefusal(harness);
  if (unsupported !== null) throw fail(unsupported.code, unsupported.message);
  if (typeof home !== "string" || !isAbsolute(home)) throw fail("E_SESSION_START_FAILED", "the launch input's home must be an absolute path");
  // The name becomes bb's project name and thread title: an argument, never an option.
  if (typeof instance !== "string" || !/^[A-Za-z0-9][^\0\n\r]*$/.test(instance)) throw fail("E_SESSION_START_FAILED", "the launch input has no instance name (one line, starting with a letter or digit)");
  if (model !== undefined && model !== null && (typeof model !== "string" || !model || model.startsWith("-"))) throw fail("E_SESSION_START_FAILED", "the launch input's model must be a model id");
  if (typeof promptFile !== "string" || !isAbsolute(promptFile)) throw fail("E_SESSION_START_FAILED", "the launch input's promptFile must be an absolute path");
  if (previous !== undefined && previous !== null && !isObject(previous)) throw fail("E_SESSION_START_FAILED", "the launch input's previous endpoint is not an object");
  // A bb thread is resumed by an input into its own conversation, never by a launch.
  if (input.resume !== undefined && input.resume !== null) throw fail("E_SESSION_START_FAILED", "the bb backend does not resume by launching: a launch starts a fresh thread, and a resume is an input to the home's thread");
  return { home, instance, model: model ?? null, promptFile, previous: previous ?? null };
}

/** → { endpoint: { server, projectId, threadId } }. Order matters: everything that can
 *  refuse runs before the first effect (archiving the previous thread, creating the
 *  project, writing Claude's local settings, spawning). */
export async function launch(input, settings, { deadline, env = process.env, spawnTimeoutMs, sandboxedModes = false } = {}) {
  const { home, instance, model, promptFile, previous } = readInput(input);
  const mode = permissionMode(input.args, input.yolo);
  // Before anything else is read or started: a mode the command does not launch in yet.
  const notOffered = sandboxedModes ? null : sandboxedModeRefusal(mode);
  if (notOffered !== null) throw fail(notOffered.code, notOffered.message);
  const launchEnv = withPathPrepend(readLaunchEnv(input.env), input.pathPrepend, env.PATH);
  const unset = readUnset(input.unset, launchEnv);
  // bb's full mode has no sandbox: nothing is written for it (and what an earlier,
  // sandboxed launch wrote is removed).
  const allowances = readSandbox(input.sandbox, { sandboxed: mode !== "full" });
  const sandbox = mode === "full" ? null : allowances;
  const refusal = sandboxRefusal(mode, allowances);
  if (refusal !== null) throw fail(refusal.code, refusal.message);
  if (!existsSync(home)) throw fail("E_SESSION_START_FAILED", `the home ${home} does not exist`);
  if (!existsSync(promptFile)) throw fail("E_SESSION_START_FAILED", `the prompt file ${promptFile} does not exist`);
  // Claude's local settings must be writable as they are (a file that is not JSON, a
  // .claude that is a link): found now, before anything in bb changes.
  const settingsToWrite = { env: launchEnv, unset, sandbox, mode, sandboxGiven: isObject(input.sandbox), missing: allowances.missing, unnamed: allowances.unnamed, otherTeams: allowances.otherTeams };
  writeLaunchSettings(home, { ...settingsToWrite, dryRun: true });

  const { problems, server } = await backendProblems(settings, { deadline, env });
  if (problems.length > 0) {
    const [first, ...rest] = problems;
    throw fail(first.code, rest.length ? `${first.message} (and ${rest.length} more: ${rest.map((problem) => problem.code).join(", ")}; see oats readiness)` : first.message);
  }
  const bb = bbClient({ cli: settings.cli, server, deadline, env, fallbackCode: "E_SESSION_START_FAILED" });

  // One thread per home: the home's project may hold the thread this launch replaces
  // (stopped by OATS, so settled), and nothing else alive.
  const { projects: mine, live } = await liveInHome(bb, home);
  const previousId = typeof previous?.threadId === "string" ? previous.threadId : null;
  const others = live.filter((thread) => thread.id !== previousId);
  if (others.length > 0) {
    throw fail("E_SESSION_START_FAILED", `a live bb thread already runs in ${home}: ${others.map((thread) => `${thread.id} (${thread.status})`).join(", ")}. One home is one thread: stop and archive ${others.length > 1 ? "them" : "it"} in bb, then start again`);
  }
  const replaced = live.find((thread) => thread.id === previousId) ?? null;
  if (replaced && !isSettled(replaced)) {
    throw fail("E_SESSION_START_FAILED", `the home's bb thread ${replaced.id} is still ${replaced.status}: stop it (oats instance stop ${instance}) before starting again`);
  }
  if (replaced) {
    const archived = await bb.archive(replaced.id);
    if (!archived.ok && archived.code !== "thread_not_found") throw fail("E_SESSION_START_FAILED", `the previous bb thread ${replaced.id} could not be archived (${archived.message})`);
  }

  let project = mine.find((candidate) => candidate.id === previous?.projectId) ?? mine[0] ?? null;
  if (project === null) {
    project = await bb.createProject(instance, home);
    // The project must be rooted exactly at the home: that is what makes the home's own
    // .claude, CLAUDE.md and hooks the thread's, and one home one project.
    if (projectsOfHome([project], home).length === 0) {
      throw fail("E_SESSION_START_FAILED", `bb created project ${project.id} with another root than the home ${home} (${JSON.stringify((project.sources ?? []).map((source) => source?.path))}): no thread was started. Remove that project in bb`);
    }
  }
  writeLaunchSettings(home, settingsToWrite);

  const args = ["--project", project.id, "--provider", BB_PROVIDER, ...(model ? ["--model", model] : []),
    "--environment", home, "--prompt-file", promptFile, "--permission-mode", mode, "--title", instance];
  const askedAt = Date.now();
  const spawned = await bb.spawn(args, spawnTimeoutMs === undefined ? {} : { timeoutMs: spawnTimeoutMs });
  const thread = spawned.ok ? spawned.value : null;
  // The answer is always a thread this home never had: bb makes a new id for every spawn,
  // and the previous thread's is never answered (the kernel tells a new session by it).
  if (spawned.ok && isObject(thread) && isBbId(thread.id) && thread.id !== previousId) return { endpoint: { server, projectId: project.id, threadId: thread.id } };
  // bb said no, or the request never reached it: nothing was created.
  if (nothingHappened(spawned)) throw fail("E_SESSION_START_FAILED", `bb thread spawn failed: ${spawned.message}`);

  // The spawn's fate is unknown: no answer in time, an answer that cannot be read or has
  // no thread id, a CLI that died, a connection that dropped after the request went out. A
  // refusal would say "nothing was started" while a thread may be running TASK.md in the
  // home, recorded nowhere. So look: a new live thread in the home is this launch's, and
  // its endpoint is the answer. Otherwise the launch stays in doubt, and the call ends
  // with no answer: the kernel then stops whatever runs in the home.
  const what = spawned.ok ? (isObject(thread) && thread.id === previousId ? "bb thread spawn answered the previous thread again" : "bb thread spawn answered no thread id") : spawned.timedOut ? `bb thread spawn did not answer in time (${spawned.message})` : `bb thread spawn ended without bb's answer (${spawned.message})`;
  // This launch's thread is one bb made after the spawn was asked for (bb and the provider
  // are on one host, so on one clock): never the previous thread, nor an older one of the
  // home that a person brought back meanwhile. A thread that does not say when it was
  // made is not taken for this launch's.
  const known = new Set([...live.map((candidate) => candidate.id), ...(previousId ? [previousId] : [])]);
  const made = (candidate) => !known.has(candidate.id) && typeof candidate.createdAt === "number" && candidate.createdAt >= askedAt;
  let found = [];
  try {
    for (let look = 0; look < SPAWN_LOOKS; look += 1) {
      if (look > 0) await sleep(SPAWN_LOOK_MS);
      found = liveThreadsOfHome(await bb.threads(), home, [project.id]).filter(made);
      if (found.length > 0) break;
    }
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    throw new InDoubt(`${what}, and the home's threads could not be read (${error.message}): a thread may be running in ${home}`);
  }
  if (found.length === 1 && isBbId(found[0].id) && found[0].projectId === project.id) return { endpoint: { server, projectId: project.id, threadId: found[0].id } };
  if (found.length > 0) throw new InDoubt(`${what}, and ${found.map((candidate) => candidate.id).join(", ")} newly run${found.length > 1 ? "" : "s"} in ${home}: whether that is this launch's thread cannot be told`);
  throw new InDoubt(`${what}, and no new thread shows in ${home} yet: one may still appear`);
}
