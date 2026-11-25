// The agent's board: its facts and its questions, as a view of its own (app/board).
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { boardInspection } from "../kernel/board.js";
import { answer, hostHome, instanceName } from "./shared.js";

const instance = z.object({ instance: instanceName }).strict();

/**
 * The board of one agent as the roster's row holds it, read with the snapshot of `at`: no command
 * of its own. `board` is the row's value AS THE KERNEL PRINTED IT (null: the home has no board
 * file), for the app to read by the one set of rules (model/board.ts): every text in it is the
 * agent's. `supported`: this kernel lists the feature `instance-board` and the row carries the
 * key; false: an older kernel, which says nothing of a board. `claim`: the row's needs-input
 * claim (`waitingOnYou`), as far as the board asks it: whose it is, and why.
 */
export const boardRow = z.object({
  at: z.string(),
  supported: z.boolean(),
  board: z.unknown(),
  claim: z.object({ producer: z.string().nullable(), reason: z.string().nullable() }).nullable(),
});

/** app -> server */
export const rpc = defineRpcContract({
  board: { input: instance, output: boardRow },
  /** `oats inspect --home --board`: each fact's history and each question's context, read when the board is in view. */
  boardDetail: { input: instance, output: boardInspection },
});

/** server -> host. `home` is the home the kernel's status named for the instance: never a caller's. */
export const host = defineRpcContract({
  boardDetail: { experimental_retryable: true, input: hostHome, output: answer(boardInspection) },
});
