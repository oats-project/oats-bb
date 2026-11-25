// A tmux agent's terminal: the command bb's own Terminal tab runs to show the agent's session
// (the kernel's viewer, kernel/terminal.ts), and the bb machine it runs on.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { answer, hostBase, instanceName } from "./shared.js";

/**
 * What the app needs to open the terminal: the bb machine that holds the home (`hostId`), the
 * command (`argv`, its first word an absolute path on that machine), and the directory it runs in.
 */
export const terminalCommand = z.object({ hostId: z.string().min(1), argv: z.array(z.string().min(1)).min(1), cwd: z.string().min(1) });

/** app -> server */
export const rpc = defineRpcContract({
  terminalCommand: { input: z.object({ instance: instanceName }).strict(), output: terminalCommand },
});

/** server -> host: no `oats` runs; the machine says where its `oats` is. `home` is the home the kernel's status named, `features` the kernel's own list. */
export const host = defineRpcContract({
  terminalCommand: {
    experimental_retryable: true,
    input: z.object({ ...hostBase, home: z.string().min(1), features: z.array(z.string()) }).strict(),
    output: answer(z.object({ argv: z.array(z.string().min(1)).min(1) })),
  },
});
