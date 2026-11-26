// The plugin's whole backend for a test: bb's fake plugin host, with the real host entry behind it
// (bb's host-entry harness) and the fake `oats` behind that. A feature's server test starts it,
// calls its RPC verbs and reads what the fake `oats` was asked (test/server.test.ts has its own
// copy of this setup, which its tests change piece by piece).
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createFakePluginHost, makeHostResponse, type FakePluginHost } from "@get-bb/plugin-sdk/testing";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { createHostEntry } from "../../host.js";
import plugin from "../../server.js";
import { installFakeOats, type Behaviour, type FakeOats } from "./fake-oats.js";

export type Backend = {
  fake: FakeOats;
  server: FakePluginHost;
  /** Calls one of the plugin's RPC verbs, as a client of bb's server does. */
  rpc<Value = unknown>(method: string, input?: unknown): Promise<Value>;
  /** The verbs the fake `oats` was asked, in order. */
  verbs(): Promise<string[]>;
  dispose(): Promise<void>;
};

/**
 * One machine (`host_checks`) with one bb project inside the fake's deployment. `load` is what is
 * loaded on the fake host: the plugin's server entry, unless a test loads a part of it.
 */
export async function startBackend(
  options: { verbs?: Record<string, Behaviour>; settings?: Record<string, string>; load?: (bb: BbPluginApi) => void | Promise<void> } = {},
): Promise<Backend> {
  const fake = await installFakeOats(options.verbs);
  await mkdir(join(fake.deployment, ".agents", "events"), { recursive: true });
  // The harness is typed by the entry's contract; the fake host hands it a method by its name.
  const hostEntry: ReturnType<typeof experimental_createHostEntryHarness<any, any>> = experimental_createHostEntryHarness(createHostEntry(), {
    experimental_paths: { dataDir: join(fake.deployment, "data"), tempDir: fake.tempDir },
    experimental_watch: () => ({ dispose: async () => undefined }),
  });
  const hosts = [makeHostResponse({ id: "host_checks", name: "checks" })];
  const projects = [{ id: "proj_release", sources: [{ hostId: "host_checks", path: join(fake.deployment, "agents", "oats-maintainer", "instances", "release-070-maintainer") }] }];
  const server = createFakePluginHost({
    pluginId: "oats",
    settings: { oatsBin: fake.bin, ...options.settings },
    sdk: {
      hosts: { list: async () => hosts },
      projects: { list: async () => projects },
    } as never,
    experimental_callHostRpc: (call) => hostEntry.experimental_call(call.method, call.input as never, { signal: call.signal }),
  });
  await (options.load ?? plugin)(server.bb);
  return {
    fake,
    server,
    rpc: <Value = unknown>(method: string, input: unknown = null) => server.harness.callRpc(method, input) as Promise<Value>,
    verbs: async () => (await fake.calls()).map((call) => call.verb),
    async dispose() {
      await server.harness.dispose();
      await hostEntry.experimental_dispose();
      await fake.remove();
    },
  };
}
