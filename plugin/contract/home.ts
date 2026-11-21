// The OATS home: it reads the roster's snapshot and acts through bb's own SDK, so it has no verb of its own yet.
import { defineRpcContract } from "@get-bb/plugin-sdk";

/** app -> server */
export const rpc = defineRpcContract({});

/** server -> host: one method per `oats` command the feature runs. */
export const host = defineRpcContract({});
