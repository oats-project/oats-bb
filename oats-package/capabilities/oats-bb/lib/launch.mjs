// launch: one OATS home becomes one bb thread (contract items 1, 4, 6).
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { bbClient, nothingHappened } from "./bb.mjs";
import { describeMissing, readLaunchEnv, readSandbox, readUnset, withPathPrepend, writeLaunchSettings } from "./local-settings.mjs";
import { InDoubt, ProviderError, fail, isObject } from "./errors.mjs";
import { backendProblems } from "./readiness.mjs";
import { isBbId, isSettled, liveInHome, liveThreadsOfHome, projectsOfHome } from "./threads.mjs";

const HARNESSES = Object.freeze(["claude"]);
const BB_PROVIDER = "claude-code";
// After a spawn whose fate is unknown: how often, and how far apart, the home's threads
// are read for the thread it may have made.
const SPAWN_LOOKS = 3;
const SPAWN_LOOK_MS = 1_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Claude Code's own permission-mode words, as a launch configuration writes them.
const PERMISSION_ARG = { auto: "auto", acceptEdits: "accept-edits", bypassPermissions: "full" };

/** bb's permission mode for the launch.
 *
 *  | the launch                                   | bb           |
 *  |----------------------------------------------|--------------|
 *  | yolo true                                    | full         |
 *  | yolo false, or no choice                     | accept-edits |
 *  | --permission-mode auto (launch configuration)| auto         |
 *  | --permission-mode acceptEdits                | accept-edits |
 *  | --permission-mode bypassPermissions          | full         |
 *
 *  `--permission-mode` is the one launch argument this backend can carry; any other is
 *  refused by name (bb starts Claude itself, so an argument has nowhere to go and is never
 *  dropped). Where yolo and the argument disagree (yolo with a mode that is not full; no
 *  yolo with bypassPermissions) the launch is refused: the provider never picks one, and
 *  never runs more permissively than the same launch would on tmux Claude. */
export function permissionMode(args, yolo) {
  if (args !== undefined && args !== null && !Array.isArray(args)) throw fail("E_BACKEND_LAUNCH_ARG", "the launch args must be a list");
  if (yolo !== true && yolo !== false && yolo !== null && yolo !== undefined) throw fail("E_SESSION_START_FAILED", "the launch input's yolo must be true, false or null");
  let mode = null;
  const list = args ?? [];
  for (let i = 0; i < list.length; i += 1) {
    const arg = list[i];
    let value = null;
    if (arg === "--permission-mode" && typeof list[i + 1] === "string") { value = list[i + 1]; i += 1; }
    else if (typeof arg === "string" && arg.startsWith("--permission-mode=")) value = arg.slice("--permission-mode=".length);
    else throw fail("E_BACKEND_LAUNCH_ARG", `the bb backend cannot carry the launch argument ${JSON.stringify(arg)}: bb starts Claude Code itself. Remove it from the launch configuration or the capability that adds it (the one argument carried is --permission-mode auto|acceptEdits|bypassPermissions)`);
    if (!Object.hasOwn(PERMISSION_ARG, value)) throw fail("E_BACKEND_LAUNCH_ARG", `the bb backend cannot carry --permission-mode ${JSON.stringify(value)}: bb's modes are auto, accept-edits (acceptEdits) and full (bypassPermissions)`);
    if (mode !== null && mode !== PERMISSION_ARG[value]) throw fail("E_BACKEND_LAUNCH_ARG", "the launch names --permission-mode twice, with different modes");
    mode = PERMISSION_ARG[value];
  }
  if (mode === null) return yolo === true ? "full" : "accept-edits";
  if (yolo === true && mode !== "full") throw fail("E_BACKEND_LAUNCH_ARG", `the launch asks for yolo and for --permission-mode ${Object.keys(PERMISSION_ARG).find((key) => PERMISSION_ARG[key] === mode)}, which disagree: drop one`);
  if (yolo === false && mode === "full") throw fail("E_BACKEND_LAUNCH_ARG", "the launch asks for no yolo and for --permission-mode bypassPermissions, which disagree: drop one");
  return mode;
}

function readInput(input) {
  if (!isObject(input)) throw fail("E_SESSION_START_FAILED", "the launch input is not an object");
  const { home, instance, harness, model, promptFile, previous } = input;
  if (typeof harness !== "string" || !HARNESSES.includes(harness)) {
    throw fail("E_BACKEND_HARNESS", `the bb backend runs ${HARNESSES.join(", ")} only, not ${JSON.stringify(harness)}`);
  }
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
export async function launch(input, settings, { deadline, env = process.env, spawnTimeoutMs } = {}) {
  const { home, instance, model, promptFile, previous } = readInput(input);
  const mode = permissionMode(input.args, input.yolo);
  const launchEnv = withPathPrepend(readLaunchEnv(input.env), input.pathPrepend, env.PATH);
  const unset = readUnset(input.unset, launchEnv);
  // bb's full mode has no sandbox: nothing is written for it (and what an earlier,
  // sandboxed launch wrote is removed).
  const allowances = readSandbox(input.sandbox);
  const sandbox = mode === "full" ? null : allowances;
  // A sandboxed launch that would lack a host it needs is refused before anything starts:
  // the agent's messaging would be cut off inside the sandbox. Full mode has no sandbox,
  // so there the gap changes nothing (readiness still names it).
  if (sandbox !== null && allowances.missing.length + allowances.unnamed > 0) {
    const named = [...allowances.missing.map(describeMissing), ...(allowances.unnamed > 0 ? [`${allowances.unnamed} more that the launch does not name in a form that can be shown`] : [])];
    throw fail("E_BACKEND_SANDBOX_HOST", `this launch runs in bb's ${mode} mode, whose sandbox must be told which hosts OATS's own commands reach, and the deployment records none for ${named.join("; ")}. Run \`oats aweb setup\` to record it, or launch in full mode (--yolo)`);
  }
  if (!existsSync(home)) throw fail("E_SESSION_START_FAILED", `the home ${home} does not exist`);
  if (!existsSync(promptFile)) throw fail("E_SESSION_START_FAILED", `the prompt file ${promptFile} does not exist`);
  // Claude's local settings must be writable as they are (a file that is not JSON, a
  // .claude that is a link): found now, before anything in bb changes.
  const settingsToWrite = { env: launchEnv, unset, sandbox, mode, sandboxGiven: isObject(input.sandbox), missing: allowances.missing, unnamed: allowances.unnamed };
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
  const spawned = await bb.spawn(args, spawnTimeoutMs === undefined ? {} : { timeoutMs: spawnTimeoutMs });
  const thread = spawned.ok ? spawned.value : null;
  if (spawned.ok && isObject(thread) && isBbId(thread.id)) return { endpoint: { server, projectId: project.id, threadId: thread.id } };
  // bb said no, or the request never reached it: nothing was created.
  if (nothingHappened(spawned)) throw fail("E_SESSION_START_FAILED", `bb thread spawn failed: ${spawned.message}`);

  // The spawn's fate is unknown: no answer in time, an answer that cannot be read or has
  // no thread id, a CLI that died, a connection that dropped after the request went out. A
  // refusal would say "nothing was started" while a thread may be running TASK.md in the
  // home, recorded nowhere. So look: a new live thread in the home is this launch's, and
  // its endpoint is the answer. Otherwise the launch stays in doubt, and the call ends
  // with no answer: the kernel then stops whatever runs in the home.
  const what = spawned.ok ? "bb thread spawn answered no thread id" : spawned.timedOut ? `bb thread spawn did not answer in time (${spawned.message})` : `bb thread spawn ended without bb's answer (${spawned.message})`;
  const known = new Set(live.map((candidate) => candidate.id));
  let found = [];
  try {
    for (let look = 0; look < SPAWN_LOOKS; look += 1) {
      if (look > 0) await sleep(SPAWN_LOOK_MS);
      found = liveThreadsOfHome(await bb.threads(), home, [project.id]).filter((candidate) => !known.has(candidate.id));
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
