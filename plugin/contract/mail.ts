// An agent's incoming mail, read-only: one read verb, and no act.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { mailPage } from "../kernel/mail.js";
import { answer, hostBase, instanceName } from "./shared.js";

/** A cursor as the app may send it back: the one an earlier page answered, one line of at most 1024 characters. */
const cursor = z.string().min(1).max(1024).regex(/^[^\x00-\x1f\x7f]+$/);

/** app -> server */
export const rpc = defineRpcContract({
  /** One page of the mail an agent received, newest first: the first, or the one after `older`. Marks nothing read. */
  mail: { input: z.object({ instance: instanceName, older: cursor.nullable() }).strict(), output: mailPage },
});

/**
 * server -> host: `oats operation run messaging:mail`, of the home the kernel's status named for
 * the instance (never a caller's). A read: retryable, and it acknowledges nothing.
 */
export const host = defineRpcContract({
  mail: { experimental_retryable: true, input: z.object({ ...hostBase, home: z.string().min(1), older: cursor.nullable() }).strict(), output: answer(mailPage) },
});
