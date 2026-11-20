// launch: one OATS home becomes one bb thread (contract items 1, 4, 6).
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { sandboxDeny } from "./deny.mjs";
import { bbClient, nothingHappened } from "./bb.mjs";
import { readLaunchEnv, readSandbox, readUnset, snapshotLaunchSettings, withPathPrepend, writeLaunchSettings } from "./local-settings.mjs";
import { harnessRefusal, permissionMode, sandboxRefusal, sandboxedModeRefusal } from "./mode.mjs";
import { InDoubt, ProviderError, fail, isObject, someOf } from "./errors.mjs";
import { backendProblems } from "./readiness.mjs";
import { archivedOf, confirmStop, relistOf, stopArchived } from "./halt.mjs";
import { hasQueuedWork, isBbId, isSettled, liveInHome, liveThreadsOfHome, projectsOfHome } from "./threads.mjs";

const BB_PROVIDER = "claude-code";
// After a spawn whose fate is unknown: how often, and how far apart, the home's threads
// are read for the thread it may have made.
const SPAWN_LOOKS = 3;
const SPAWN_LOOK_MS = 1_000;
// How long a launch waits for an earlier thread of the home to settle when it stops it:
// the kernel stopped the home before this start, so the thread is at rest already.
const CLEANUP_GRACE_SECONDS = 5;
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
  // A sandboxed launch also writes the deny rules that keep the agent's tools off what is
  // run, or read as configuration, outside its sandbox (D16 rule 1). They are built from
  // what the kernel says (the home, its trees) and from this host (the user's Claude
  // configuration, bb's data directory): never from anything the home holds.
  const deny = mode === "full" ? null : sandboxDeny({ mode, home, trees: input.trees, dataDir: settings.dataDir });
  // Claude's local settings must be writable as they are (a file that is not JSON, a
  // .claude that is a link): found now, before anything in bb changes.
  const settingsToWrite = { env: launchEnv, unset, sandbox, deny };
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
    // The remedy and the count before the list, which may be long.
    throw fail("E_SESSION_START_FAILED", `${others.length > 1 ? `${others.length} live bb threads already run` : "a live bb thread already runs"} in ${home}. One home is one thread: stop and archive ${others.length > 1 ? "them" : "it"} in bb, then start again. Running there: ${someOf(others.map((thread) => `${thread.id} (${thread.status})`))}`);
  }
  const replaced = live.find((thread) => thread.id === previousId) ?? null;
  if (replaced && (!isSettled(replaced) || hasQueuedWork(replaced))) {
    throw fail("E_SESSION_START_FAILED", `the home's bb thread ${replaced.id} is still ${isSettled(replaced) ? `${replaced.status} with a turn bb holds in line` : replaced.status}: stop it (oats instance stop ${instance}) before starting again`);
  }
  // No Claude of an earlier thread may be left in the home beside the new one. bb keeps
  // the process of an archived thread loaded and shows nothing that says so, so the
  // previous thread is stopped before it is archived, and the home's archived threads are
  // stopped: those archived since the previous thread was made (in bb's UI, by a person),
  // or all of them where that time is not known. Earlier ones were stopped by the launch
  // that made the previous thread.
  //
  // Every read comes first, so that nothing has changed when one of them fails.
  let since = null;
  if (replaced && typeof replaced.createdAt === "number") since = replaced.createdAt;
  else if (previousId && isBbId(previousId) && !replaced) {
    // Only a bound on the sweep: where bb does not show the previous thread, all are swept.
    try {
      const before = await bb.thread(previousId);
      if (before !== null && typeof before.createdAt === "number") since = before.createdAt;
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
    }
  }
  // Every thread of the home's project that bb has now, live or archived: none of them is
  // the thread this launch makes.
  const archivedNow = mine.length > 0 ? await archivedOf(bb, mine.map((candidate) => candidate.id)) : [];
  const toSweep = archivedNow.filter((thread) => since === null || typeof thread.archivedAt !== "number" || thread.archivedAt >= since);
  const known = new Set([...live.map((candidate) => candidate.id), ...archivedNow.map((candidate) => candidate.id), ...(previousId ? [previousId] : [])]);
  // And the launch's own files in the home as they stand, to put back should it end in a
  // refusal: read here, by the confined read, before anything is changed.
  const restoreSettings = snapshotLaunchSettings(home);

  // Then the changes, and from the first one that MAY have happened a failure is no longer
  // a refusal: the kernel reads a refusal as "nothing happened" and may drop its record
  // that a launch was sent. A stop of a thread at rest counts (a loaded process may have
  // been released, a held message withdrawn), and so does a call whose answer was lost.
  // What cannot be completed after that ends with no answer, as every outcome in doubt
  // does. Two things stay refusals, because they are known to have changed nothing: bb's
  // own no to creating the home's project when nothing came before it, and bb's own no to
  // the spawn when the only change was the launch's own settings file, which is put back.
  let effect = null;
  // Whatever fails after that, of bb's or of this machine's (a write the disk refuses): no answer.
  const inDoubtAfter = (error) => (effect !== null && !(error instanceof InDoubt)
    ? new InDoubt(`${error?.message ?? error}. The launch may already have changed bb or the home (${effect}), so this is not a refusal`) : error);
  let project;
  try {
    if (replaced || toSweep.length > 0) {
      effect = "it asked bb to stop earlier threads of this home";
      if (replaced) await confirmStop(bb, replaced.id, { deadline, grace: CLEANUP_GRACE_SECONDS });
      await stopArchived(bb, toSweep, relistOf(bb, mine.map((candidate) => candidate.id)), { deadline, grace: CLEANUP_GRACE_SECONDS });
    }
    if (replaced) {
      const archived = await bb.archive(replaced.id);
      if (!archived.ok && archived.code !== "thread_not_found") throw fail("E_SESSION_START_FAILED", `the previous bb thread ${replaced.id} could not be archived (${archived.message})`);
      effect = `the home's previous thread ${replaced.id} is archived`;
    }
    project = mine.find((candidate) => candidate.id === previous?.projectId) ?? mine[0] ?? null;
    if (project === null) {
      const before = effect;
      effect = "it asked bb to create the home's project";
      try { project = await bb.createProject(instance, home); }
      catch (error) {
        // bb's own no, with nothing before it: no project was made, and nothing else was changed.
        if (before === null && error instanceof ProviderError && isObject(error.bb) && nothingHappened(error.bb)) effect = null;
        throw error;
      }
      effect = `bb project ${project.id} was created`;
      // The project must be rooted exactly at the home: that is what makes the home's own
      // .claude, CLAUDE.md and hooks the thread's, and one home one project.
      if (projectsOfHome([project], home).length === 0) {
        throw fail("E_SESSION_START_FAILED", `bb created project ${project.id} with another root than the home ${home} (${JSON.stringify((project.sources ?? []).map((source) => source?.path))}): no thread was started. Remove that project in bb`);
      }
    }
    // The launch's own files in the home. Where the write fails with nothing else
    // changed, they are put back as they were and the failure is a refusal; where they
    // cannot be put back, the home was changed, and it is not one.
    try { writeLaunchSettings(home, settingsToWrite); }
    catch (error) {
      if (effect === null) {
        try { restoreSettings(); }
        catch (failed) { throw new InDoubt(`${error?.message ?? error}. The launch's files in the home could not be put back as they were (${failed?.code ?? failed?.message ?? failed}), so this is not a refusal`); }
      }
      throw error;
    }

  } catch (error) { throw inDoubtAfter(error); }

  const args = ["--project", project.id, "--provider", BB_PROVIDER, ...(model ? ["--model", model] : []),
    "--environment", home, "--prompt-file", promptFile, "--permission-mode", mode, "--title", instance];
  const askedAt = Date.now();
  const spawned = await bb.spawn(args, spawnTimeoutMs === undefined ? {} : { timeoutMs: spawnTimeoutMs });
  const thread = spawned.ok ? spawned.value : null;
  // The answer is always a thread this home never had. bb makes a new id for every spawn;
  // an answer that names a thread bb already had before the spawn (the previous one, or an
  // older one, live or archived), or one of another project, is not taken for it: the
  // launch then looks, as for any spawn whose fate it cannot tell.
  const fresh = spawned.ok && isObject(thread) && isBbId(thread.id) && !known.has(thread.id)
    && (thread.projectId === undefined || thread.projectId === null || thread.projectId === project.id);
  if (fresh) return { endpoint: { server, projectId: project.id, threadId: thread.id } };
  // bb said no, or the request never reached it: no thread was created. With nothing else
  // changed, the launch's own settings file is put back as it was, and this is a refusal.
  if (nothingHappened(spawned)) {
    const refused = fail("E_SESSION_START_FAILED", `bb thread spawn failed: ${spawned.message}`);
    if (effect === null) {
      try { restoreSettings(); }
      catch (error) { throw new InDoubt(`${refused.message}. The launch's settings file could not be put back as it was (${error?.code ?? error?.message ?? error}), so this is not a refusal`); }
      throw refused;
    }
    throw inDoubtAfter(refused);
  }

  // The spawn's fate is unknown: no answer in time, an answer that cannot be read or has
  // no thread id, a CLI that died, a connection that dropped after the request went out. A
  // refusal would say "nothing was started" while a thread may be running TASK.md in the
  // home, recorded nowhere. So look: a new live thread in the home is this launch's, and
  // its endpoint is the answer. Otherwise the launch stays in doubt, and the call ends
  // with no answer: the kernel then stops whatever runs in the home.
  const what = spawned.ok ? (isObject(thread) && isBbId(thread.id) ? (thread.id === previousId ? "bb thread spawn answered the previous thread again" : "bb thread spawn answered a thread bb already had, or one of another project") : "bb thread spawn answered no thread id") : spawned.timedOut ? `bb thread spawn did not answer in time (${spawned.message})` : `bb thread spawn ended without bb's answer (${spawned.message})`;
  // This launch's thread is one bb made after the spawn was asked for (bb and the provider
  // are on one host, so on one clock): never the previous thread, nor an older one of the
  // home that a person brought back meanwhile. A thread that does not say when it was
  // made is not taken for this launch's.
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
