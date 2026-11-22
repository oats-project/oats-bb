// The OATS home: it reads the roster's snapshot and acts through bb's own SDK. Its one verb of its
// own says where the installed `oats` stands against what the plugin is built for (kernel/compat.ts).
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

/**
 * The installed `oats`, from `oats version --json` (the read every feature shares): its release
 * and the version of its JSON answers, each null when the kernel's answer names none, and where
 * that stands (kernel/compat.ts `compat`): "older" than the plugin works with, "tested", "newer"
 * than what was tested, "newer-api" (its answers are of a later version than the plugin reads), or
 * "unknown" (it answered and its version cannot be read).
 */
export const cli = z.object({
  version: z.string().nullable(),
  desktopApi: z.number().nullable(),
  state: z.enum(["older", "tested", "newer", "newer-api", "unknown"]),
});

/** app -> server */
export const rpc = defineRpcContract({
  homeCli: { input: z.null(), output: cli },
});

/** server -> host: one method per `oats` command the feature runs. */
export const host = defineRpcContract({});
