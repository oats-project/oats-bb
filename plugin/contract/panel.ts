// The instance panel: its developer adds its verbs here.
import { defineRpcContract } from "@get-bb/plugin-sdk";

/** app -> server */
export const rpc = defineRpcContract({});

/** server -> host: one method per `oats` command the feature runs. */
export const host = defineRpcContract({});
