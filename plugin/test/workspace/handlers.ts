// The four pages' RPC methods, with small answers of the shape the server gives.
import type { PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { rpc } from "../../contract/workspace";

export const SOULS = [
  {
    name: "oats-developer",
    agent: "oats-developer",
    description: "Builds and proves one spec.",
    origin: "oats.framework 1.12.0",
    capabilities: ["oats.core", "oats.aweb", "oats.developer"],
    spawnable: true,
    problem: null,
  },
  {
    name: "broken-soul",
    agent: "broken-soul",
    description: "",
    origin: "this repository",
    capabilities: [],
    spawnable: false,
    problem: "E_SOUL_INVALID: soul.yaml names a capability that is not installed: oats.missing",
  },
];

export const defaults = (): PluginRpcTestHandlers<typeof rpc> => ({
  souls: () => ({ souls: SOULS }),
  capabilities: () => ({
    capabilities: [{ id: "oats.core", description: "Day-to-day operation.", origin: "oats.framework 1.12.0", souls: 9 }],
  }),
  teams: () => ({ teams: [{ label: "oats", team: "default:oats.aweb.ai", isDefault: true }] }),
  machines: () => ({ machines: [{ id: "falcon", route: null, isThisMachine: true, label: null, folder: null }] }),
});
