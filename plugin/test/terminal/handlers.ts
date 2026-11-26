// The terminal's default RPC answers for the app's tests (test/helpers/render.ts composes them).
import type { PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { rpc } from "../../contract/terminal";

export const HOST = "host_falcon";
export const OATS_BIN = "/usr/local/bin/oats";
/** The viewer's command as the server answers it for a home, on a kernel that lists both of the viewer's features. */
export const commandFor = (instance: string) => {
  const home = `/srv/oats/agents/oats-developer/instances/${instance}`;
  return { hostId: HOST, argv: [OATS_BIN, "session", "attach", "--home", home, "--detach-key", "C-\\", "--no-status-line"], cwd: home };
};

export const defaults = (): PluginRpcTestHandlers<typeof rpc> => ({
  terminalCommand: ({ instance }) => commandFor(instance),
});
