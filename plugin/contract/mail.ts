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
 * the instance (never a caller's). A read, and it acknowledges nothing.
 *
 * NOT `experimental_retryable`, alone among the plugin's reads. bb cancels a retryable host call
 * at HALF its transport timeout and sends it once more with what is left (server/core.ts
 * `HOST_TIMEOUT`). This read may rightly take minutes (one `aw` call per identity; the messaging
 * layer's own budget is 150 s): retried, a read of a hundred seconds would be killed, started
 * again, and killed again, and never answer. A read that is lost says so, and a person presses Retry.
 */
export const host = defineRpcContract({
  mail: { input: z.object({ ...hostBase, home: z.string().min(1), older: cursor.nullable() }).strict(), output: answer(mailPage) },
});
