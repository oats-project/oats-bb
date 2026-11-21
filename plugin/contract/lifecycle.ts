// Stop, start, restart and retire, each through OATS.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { answer, hostApply, hostHome, hostInstance, instanceName, key, plan } from "./shared.js";

const instance = z.object({ instance: instanceName }).strict();
const apply = z.object({ instance: instanceName, revision: z.string(), key }).strict();
const done = z.object({ ok: z.literal(true) });
const thread = z.object({ threadId: z.string() });

export const rpc = defineRpcContract({
  stopPlan: { input: instance, output: plan },
  stopApply: { input: apply, output: done },
  start: { input: instance, output: thread },
  restart: { input: instance, output: thread },
  retirePlan: { input: instance, output: plan },
  retireApply: { input: apply, output: done },
});

const threadAnswer = answer(z.object({ threadId: z.string().nullable() }));

export const host = defineRpcContract({
  stopPlan: { experimental_retryable: true, input: hostInstance, output: answer(plan) },
  stopApply: { input: hostApply, output: answer(z.object({})) },
  start: { input: hostHome, output: threadAnswer },
  restart: { input: hostHome, output: threadAnswer },
  /** Not retryable: each retire plan appends one `retire-planned` event to the workspace log. */
  retirePlan: { input: hostInstance, output: answer(plan) },
  retireApply: { input: hostApply, output: answer(z.object({})) },
});
