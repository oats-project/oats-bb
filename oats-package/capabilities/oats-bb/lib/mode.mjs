// The mode a launch runs in, and what that mode needs of the sandbox: read by the launch
// and by the readiness check of a planned launch, so both answer the same.
import { fail } from "./errors.mjs";
import { gapList, missingRemedy } from "./local-settings.mjs";

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

export const HARNESSES = Object.freeze(["claude"]);

/** Why this provider cannot run the harness, or null. → {code, message} | null. */
export function harnessRefusal(harness) {
  if (typeof harness === "string" && HARNESSES.includes(harness)) return null;
  return { code: "E_BACKEND_HARNESS", message: `the bb backend runs ${HARNESSES.join(", ")} only, not ${JSON.stringify(harness)}` };
}

/** Why the provider's command does not launch in this mode yet, or null. bb's sandboxed
 *  modes (auto, accept-edits) let the agent's tools write files of its own home that are
 *  later run, or read as configuration, outside the sandbox. The rules that keep them off
 *  (contract item 6c) are not in this release, so the command launches in full mode only.
 *  → {code, message} | null (the launch and the readiness check share it). */
export function sandboxedModeRefusal(mode) {
  if (mode === "full") return null;
  return { code: "E_BACKEND_SANDBOXED_MODE", message: `this launch would run in bb's ${mode} mode, a sandboxed mode, and the bb backend does not launch in one yet: the rules that keep a sandboxed agent's tools off its own home's hooks, settings and module copies come with a later release of this provider. Launch in bb's full mode: spawn or start with --yolo (or a launch configuration's --permission-mode bypassPermissions). Nothing was started` };
}

/** Why a launch in this mode cannot have the sandbox it needs, or null. A sandboxed launch
 *  that would lack a host OATS's own commands reach is refused before anything starts:
 *  the agent's messaging would be cut off inside the sandbox. Full mode has no sandbox, so
 *  there neither a gap nor an unresolved configuration changes anything. Optional rows
 *  never refuse, and neither does a team other than the soul's default: the agent's own
 *  team is served, and readiness says what it cannot do for the other. → {code, message} | null (the launch and the readiness check share it). */
export function sandboxRefusal(mode, allowances) {
  if (mode === "full") return null;
  if (allowances.unavailable !== null) {
    // The remedy before the cause: the kernel relays 500 characters.
    return { code: "E_BACKEND_SANDBOX_UNAVAILABLE", message: `this launch runs in bb's ${mode} mode, whose sandbox must be told which hosts and paths OATS's own commands reach, and the deployment's configuration could not be resolved for it. Fix the cause, or launch in full mode (--yolo). Cause: ${allowances.unavailable}` };
  }
  if (allowances.missing.length + allowances.unnamed === 0) return null;
  // The remedy before the list: the kernel relays 500 characters, and the list can be long.
  return { code: "E_BACKEND_SANDBOX_HOST", message: `this launch runs in bb's ${mode} mode, whose sandbox must be told which hosts OATS's own commands reach, and the deployment records none for some. ${missingRemedy(allowances.missing)}, or launch in full mode (--yolo). Missing: ${gapList(allowances.missing, allowances.unnamed)}` };
}
