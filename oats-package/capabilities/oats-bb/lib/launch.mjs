// launch: one OATS home becomes one bb thread (contract items 1, 4, 6).
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { bbClient } from "./bb.mjs";
import { readLaunchEnv, readSandbox, readUnset, writeLaunchSettings } from "./local-settings.mjs";
import { fail, isObject } from "./errors.mjs";
import { backendProblems } from "./readiness.mjs";
import { isSettled, liveThreadsOfHome, projectsOfHome } from "./threads.mjs";

export const HARNESSES = Object.freeze(["claude"]);
const BB_PROVIDER = "claude-code";
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
  if (typeof instance !== "string" || !instance) throw fail("E_SESSION_START_FAILED", "the launch input has no instance name");
  if (model !== undefined && model !== null && (typeof model !== "string" || !model || model.startsWith("-"))) throw fail("E_SESSION_START_FAILED", "the launch input's model must be a model id");
  if (typeof promptFile !== "string" || !isAbsolute(promptFile)) throw fail("E_SESSION_START_FAILED", "the launch input's promptFile must be an absolute path");
  if (previous !== undefined && previous !== null && !isObject(previous)) throw fail("E_SESSION_START_FAILED", "the launch input's previous endpoint is not an object");
  return { home, instance, model: model ?? null, promptFile, previous: previous ?? null };
}

/** → { endpoint: { server, projectId, threadId } }. Order matters: everything that can
 *  refuse runs before the first effect (archiving the previous thread, creating the
 *  project, writing Claude's local settings, spawning). */
export async function launch(input, settings, { deadline, env = process.env } = {}) {
  const { home, instance, model, promptFile, previous } = readInput(input);
  const mode = permissionMode(input.args, input.yolo);
  const launchEnv = readLaunchEnv(input.env);
  const unset = readUnset(input.unset, launchEnv);
  // bb's full mode has no sandbox: nothing is written for it (and what an earlier,
  // sandboxed launch wrote is removed).
  const allowances = readSandbox(input.sandbox);
  const sandbox = mode === "full" ? null : allowances;
  if (!existsSync(home)) throw fail("E_SESSION_START_FAILED", `the home ${home} does not exist`);
  if (!existsSync(promptFile)) throw fail("E_SESSION_START_FAILED", `the prompt file ${promptFile} does not exist`);

  const { problems, server } = await backendProblems(settings, { deadline, env });
  if (problems.length > 0) {
    const [first, ...rest] = problems;
    throw fail(first.code, rest.length ? `${first.message} (and ${rest.length} more: ${rest.map((problem) => problem.code).join(", ")}; see oats readiness)` : first.message);
  }
  const bb = bbClient({ cli: settings.cli, server, deadline, env, fallbackCode: "E_SESSION_START_FAILED" });

  // One thread per home: the home's project may hold the thread this launch replaces
  // (stopped by OATS, so settled), and nothing else alive.
  const [projects, threads] = [await bb.projects(), await bb.threads()];
  const mine = projectsOfHome(projects, home);
  const live = liveThreadsOfHome(threads, home, mine.map((project) => project.id));
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

  const project = mine.find((candidate) => candidate.id === previous?.projectId) ?? mine[0] ?? await bb.createProject(instance, home);
  writeLaunchSettings(home, { env: launchEnv, unset, sandbox });

  const args = ["--project", project.id, "--provider", BB_PROVIDER, ...(model ? ["--model", model] : []),
    "--environment", home, "--prompt-file", promptFile, "--permission-mode", mode, "--title", instance];
  const spawned = await bb.spawn(args);
  if (!spawned.ok) {
    // A spawn whose answer was lost may still have made the thread: say so. (The kernel
    // then stops whatever runs in the home: a stop with no endpoint.)
    throw fail("E_SESSION_START_FAILED", `bb thread spawn failed: ${spawned.message}${spawned.timedOut ? "; the thread may have been created" : ""}`);
  }
  const thread = spawned.value;
  if (!isObject(thread) || typeof thread.id !== "string" || !thread.id) throw fail("E_SESSION_START_FAILED", "bb thread spawn answered no thread id; the thread may have been created");
  return { endpoint: { server, projectId: project.id, threadId: thread.id } };
}
