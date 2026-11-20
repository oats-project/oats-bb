// The provider's session commands, as the kernel calls them: one handler per verb.
import { isAbsolute } from "node:path";
import { inspect, inspectMany } from "./inspect.mjs";
import { sendInput } from "./input.mjs";
import { launch } from "./launch.mjs";
import { plannedLaunchFindings, readinessResult, sandboxWarnings } from "./readiness.mjs";
import { readSettings } from "./settings.mjs";
import { stop } from "./stop.mjs";

const withSettings = (run) => (input, rawSettings, options) => run(input, readSettings(rawSettings), options);

/** The planned launch of a check input: `launch: {harness, yolo, args, sandbox}`, there before
 *  every launch and absent on a plain readiness read. */
function plannedLaunch(input) {
  const planned = input !== null && typeof input === "object" ? input.launch : null;
  return planned !== null && typeof planned === "object" && !Array.isArray(planned) ? planned : null;
}

/** The handlers of the six verbs.
 *
 *  `sandboxedModes`: whether a launch in one of bb's sandboxed modes (auto, accept-edits)
 *  is taken. The provider's command does not take one yet (false, the default, and the
 *  only value `bin/oats-bb.mjs` uses): the rules that keep a sandboxed agent's tools off
 *  what runs outside its sandbox (contract item 6c) are not in this release, so such a
 *  launch is refused before anything starts and the check says so. The code and the tests
 *  of the sandboxed modes are here already; the tests reach them with `true`. */
export function sessionHandlers({ sandboxedModes = false } = {}) {
  return {
    launch: (input, rawSettings, options) => launch(input, readSettings(rawSettings), { ...options, sandboxedModes }),
    inspect: withSettings(inspect),
    inspectMany: withSettings(inspectMany),
    input: withSettings(sendInput),
    stop: withSettings(stop),
    // input: {home | null, soul | null, settings?, launch?: {harness, yolo, args, sandbox}}.
    // bb's own state depends on the settings alone. With the planned launch the kernel
    // hands it, the check also says what that launch would be refused for; for a home, it
    // lists what the provider added to the sandbox at its last launch.
    check: async (input, rawSettings, options) => {
      const planned = plannedLaunch(input);
      const { result } = await readinessResult(readSettings(rawSettings), { ...options, extra: planned ? plannedLaunchFindings(planned, { sandboxedModes }) : undefined });
      if (typeof input?.home === "string" && isAbsolute(input.home)) result.warnings.push(...sandboxWarnings(input.home, { planned: planned !== null }));
      return result;
    },
  };
}
