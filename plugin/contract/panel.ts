// The instance panel: who an agent is and how it runs, as the OATS Desktop's instance panel shows it.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { panelBoard, panelBoardAnswer } from "../kernel/panel-board.js";
import { panelEvents } from "../kernel/panel-events.js";
import { panelInstance } from "../kernel/panel-instance.js";
import { panelReadiness } from "../kernel/panel-readiness.js";
import { panelSoul } from "../kernel/panel-soul.js";
import { answer, hostBase, hostHome, instanceName } from "./shared.js";

const instance = z.object({ instance: instanceName }).strict();

/** The Instance tab's facts and the Soul tab's header, as read with the snapshot of `at`. */
export const instanceFacts = z.object({
  at: z.string(),
  /** the instance's own row of `oats status --json` */
  facts: panelInstance,
  /** the agent's board as the row holds it now (no history, no context); `state` says when there is none */
  board: panelBoard,
  /** the row's waiting claim is the board's own (producer `oats.board`): its questions are shown as questions, not as a second message */
  boardClaim: z.boolean(),
  /** the roster's `root`: `<deployment>/agents` */
  agentsRoot: z.string().nullable(),
  /** the instance's soul, from the roster's row of its agent group; each null when that row does not say */
  soul: z.object({
    /** the soul key (`<package>/<soul>` for a package soul): what the Souls page opens by, and what `oats readiness --soul` takes */
    key: z.string().nullable(),
    description: z.string().nullable(),
  }),
});

/** The soul as the instance was spawned from it; `soul` is null when the kernel's inspection names none. */
export const soulAnswer = z.object({ soul: panelSoul.nullable() });

/**
 * A person's answer to one question of the agent's board. The question is named by its id and the
 * instant it was asked (an id asked again is another question), the option by its place; `text` is
 * the exact line the person confirmed. The server sends nothing unless the kernel's own board holds
 * that question now and its line for that option is this text.
 */
export const boardAnswerInput = z
  .object({ instance: instanceName, id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,15}$/), since: z.string().min(1).max(40), option: z.number().int().min(0).max(3), text: z.string().min(1).max(400) })
  .strict();
/** What was sent, and the kernel's words for it. */
export const boardAnswer = panelBoardAnswer.extend({ text: z.string() });

/** app -> server */
export const rpc = defineRpcContract({
  panelInstance: { input: instance, output: instanceFacts },
  /** `oats inspect --home`: the Soul tab's body. */
  panelSoul: { input: instance, output: soulAnswer },
  /** `oats instance events`: the recorded lifecycle activity. */
  panelEvents: { input: instance, output: panelEvents },
  /** `oats readiness`, of the instance's home or of its soul. */
  panelReadiness: { input: z.object({ instance: instanceName, of: z.enum(["instance", "soul"]) }).strict(), output: panelReadiness },
  /** `oats inspect --home --board`: the board with each fact's history and each question's context. */
  panelBoard: { input: instance, output: panelBoard },
  /** `oats session input`: one answer to one board question, as the agent's next input. */
  panelBoardAnswer: { input: boardAnswerInput, output: boardAnswer },
});

/**
 * server -> host: one method per `oats` command the feature runs. `home` is the home the kernel's
 * status named for the instance, and `soul` a soul key the kernel's roster named: never a caller's.
 */
export const host = defineRpcContract({
  panelSoul: { experimental_retryable: true, input: hostHome, output: answer(soulAnswer) },
  panelEvents: { experimental_retryable: true, input: z.object({ ...hostBase, instance: instanceName, home: z.string().min(1) }).strict(), output: answer(panelEvents) },
  panelReadiness: { experimental_retryable: true, input: hostHome, output: answer(panelReadiness) },
  panelSoulReadiness: { experimental_retryable: true, input: z.object({ ...hostBase, soul: z.string().min(1).max(128) }).strict(), output: answer(panelReadiness) },
  panelBoard: { experimental_retryable: true, input: hostHome, output: answer(panelBoard) },
  /** Not retryable: an input sent twice is two turns. `text` is the line the server derived from the kernel's board. */
  panelBoardAnswer: { input: z.object({ ...hostBase, home: z.string().min(1), text: z.string().min(1).max(400) }).strict(), output: answer(panelBoardAnswer) },
});
