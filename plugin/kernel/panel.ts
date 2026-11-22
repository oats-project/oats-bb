// The `oats` commands of the instance panel, each as the argv it builds and the answer it reads
// (kernel/panel-*.ts hold them, one file per command's answer).
import { checkHome } from "./input.js";
import { boardAnswerArgv, checkAnswerText, panelBoardArgv, parseBoardAnswer, parsePanelBoard, type PanelBoard, type PanelBoardAnswer } from "./panel-board.js";
import { panelEventsArgv, parsePanelEvents, type PanelEvents } from "./panel-events.js";
import { panelReadinessArgv, panelSoulReadinessArgv, parsePanelReadiness, type PanelReadiness } from "./panel-readiness.js";
import { panelSoulArgv, parsePanelSoul, type PanelSoul } from "./panel-soul.js";
import { ok, type Result } from "./result.js";
import type { Runner } from "./runner.js";
import { withTaskFile } from "./task-file.js";

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
  /** `oats inspect --home <abs> --board --json`: the board with each fact's history and each question's context. */
  panelBoard: (home: string, signal?: AbortSignal): Promise<Result<PanelBoard>> => oats.run(panelBoardArgv(home), parsePanelBoard, oats.timeouts.read, signal),
  /**
   * `oats session input --home <abs> --text-file <f> --json`: a board question's answer, as the
   * agent's next input. The text travels as a 0600 file in `tempDir`, removed when the call ends;
   * a text that is no board answer starts no process and writes no file.
   */
  async panelBoardAnswer(home: string, text: string, tempDir: string, signal?: AbortSignal): Promise<Result<PanelBoardAnswer>> {
    const checked = checkAnswerText(text);
    if (!checked.ok) return checked;
    // The home is checked before the file is written.
    const where = checkHome(home);
    if (!where.ok) return where;
    return withTaskFile(tempDir, checked.value, (file) => oats.run(boardAnswerArgv(where.value, file), parseBoardAnswer, oats.timeouts.act, signal));
  },
  /** `oats readiness --soul <key> --policy --json`; `knownSouls` is what `oats souls` lists. */
  panelSoulReadiness: (soul: string, knownSouls: readonly string[], signal?: AbortSignal): Promise<Result<PanelReadiness>> =>
    oats.run(panelSoulReadinessArgv(soul, knownSouls), parsePanelReadiness, oats.timeouts.read, signal),
});
