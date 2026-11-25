// The agent's board, with its history and context: `oats inspect --home <abs> --board --json`
// (OATS's docs/desktop-cli-api.md, "The agent's board": "read it when a view is open, not on every
// poll"). The row's own `board`, without history and context, comes with every `oats status`
// (the roster's read): this command is run only when a person looks at an agent's board.
//
// The answer is passed on AS THE KERNEL PRINTED IT (`inspection`): model/board.ts reads it, in the
// app, by the one set of rules that also reads the row's board, and tells apart a board, no board,
// a kernel that sends none, and an answer it cannot read. Nothing here trusts a word of it.
import { z } from "zod";
import { shaped } from "./envelope.js";
import { checkHome } from "./input.js";
import { ok, type Result } from "./result.js";
import type { Runner } from "./runner.js";

/** The inspection's answer, whole: an object. (Every text in a board is the agent's: read by model/board.ts `boardDetailData`.) */
export const boardInspection = z.object({ inspection: z.record(z.string(), z.unknown()) });
export type BoardInspection = z.output<typeof boardInspection>;

export function boardDetailArgv(home: string): Result<string[]> {
  const checked = checkHome(home);
  return checked.ok ? ok(["inspect", "--home", checked.value, "--board", "--json"]) : checked;
}

export function parseBoardDetail(document: unknown): Result<BoardInspection> {
  const parsed = shaped(z.record(z.string(), z.unknown()), document, "oats inspect --board");
  return parsed.ok ? ok({ inspection: parsed.value }) : parsed;
}

export const verbs = (oats: Runner) => ({
  /** `oats inspect --home <abs> --board --json`: the board with each fact's history and each question's context. */
  boardDetail: (home: string, signal?: AbortSignal): Promise<Result<BoardInspection>> => oats.run(boardDetailArgv(home), parseBoardDetail, oats.timeouts.read, signal),
});
