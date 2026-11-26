// The agent's board, with its history and context: `oats inspect --home <abs> --board --json`
// (OATS's docs/desktop-cli-api.md, "The agent's board": "read it when a view is open, not on every
// poll"). The row's own `board`, without history and context, comes with every `oats status`
// (the roster's read): this command is run only when a person looks at an agent's board.
//
// THE BOARD ALONE is passed on, as the kernel printed it (`inspection`): the inspection holds much
// more (the workspace, the souls, the launch, the identity: ten kilobytes on a small deployment),
// and a view of an agent's board is handed none of it. What is kept is the board under the key
// the kernel printed it at (`instance.board`, or `board`), or neither where the kernel sent none:
// model/board.ts reads it, in the app, by the one set of rules that also reads the row's board,
// and tells apart a board, no board, a kernel that sends none, and an answer it cannot read.
// Nothing here trusts a word of it.
import { z } from "zod";
import { shaped } from "./envelope.js";
import { checkHome } from "./input.js";
import { ok, type Result } from "./result.js";
import type { Runner } from "./runner.js";

/** The inspection's answer, the board's part of it alone. (Every text in a board is the agent's: read by model/board.ts `boardDetailData`.) */
export const boardInspection = z.object({ inspection: z.record(z.string(), z.unknown()) });
export type BoardInspection = z.output<typeof boardInspection>;

export function boardDetailArgv(home: string): Result<string[]> {
  const checked = checkHome(home);
  return checked.ok ? ok(["inspect", "--home", checked.value, "--board", "--json"]) : checked;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
/** The board's part of an inspection, under the key the kernel printed it at; `{}` where it printed none. */
function boardOnly(inspection: Record<string, unknown>): Record<string, unknown> {
  if (Object.hasOwn(inspection, "board")) return { board: inspection.board };
  const instance = inspection.instance;
  return isRecord(instance) && Object.hasOwn(instance, "board") ? { instance: { board: instance.board } } : {};
}

export function parseBoardDetail(document: unknown): Result<BoardInspection> {
  const parsed = shaped(z.record(z.string(), z.unknown()), document, "oats inspect --board");
  return parsed.ok ? ok({ inspection: boardOnly(parsed.value) }) : parsed;
}

export const verbs = (oats: Runner) => ({
  /** `oats inspect --home <abs> --board --json`: the board with each fact's history and each question's context. */
  boardDetail: (home: string, signal?: AbortSignal): Promise<Result<BoardInspection>> => oats.run(boardDetailArgv(home), parseBoardDetail, oats.timeouts.read, signal),
});
