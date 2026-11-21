// The `oats` commands of the instance panel, each as the argv it builds and the answer it reads
// (kernel/panel-*.ts hold them, one file per command's answer).
import { panelEventsArgv, parsePanelEvents, type PanelEvents } from "./panel-events.js";
import { panelReadinessArgv, panelSoulReadinessArgv, parsePanelReadiness, type PanelReadiness } from "./panel-readiness.js";
import { panelSoulArgv, parsePanelSoul, type PanelSoul } from "./panel-soul.js";
import { ok, type Result } from "./result.js";
import type { Runner } from "./runner.js";

export const verbs = (oats: Runner) => ({
  /** `oats inspect --home <abs> --json`: the soul as the instance was spawned from it. */
  panelSoul: async (home: string, signal?: AbortSignal): Promise<Result<{ soul: PanelSoul | null }>> => {
    const read = await oats.run(panelSoulArgv(home), parsePanelSoul, oats.timeouts.read, signal);
    return read.ok ? ok({ soul: read.value }) : read;
  },
  /** `oats instance events <instance> --home <abs> --limit 100 --json`. */
  panelEvents: (instance: string, home: string, signal?: AbortSignal): Promise<Result<PanelEvents>> =>
    oats.run(panelEventsArgv(instance, home), parsePanelEvents, oats.timeouts.read, signal),
  /** `oats readiness --home <abs> --policy --json`. */
  panelReadiness: (home: string, signal?: AbortSignal): Promise<Result<PanelReadiness>> => oats.run(panelReadinessArgv(home), parsePanelReadiness, oats.timeouts.read, signal),
  /** `oats readiness --soul <key> --policy --json`; `knownSouls` is what `oats souls` lists. */
  panelSoulReadiness: (soul: string, knownSouls: readonly string[], signal?: AbortSignal): Promise<Result<PanelReadiness>> =>
    oats.run(panelSoulReadinessArgv(soul, knownSouls), parsePanelReadiness, oats.timeouts.read, signal),
});
