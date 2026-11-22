// The feature's RPC methods as a slot test's default: the lists and a trigger's state as the
// server answers them, from what the real kernel printed (test/fixtures/automations/).
import type { PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { rpc } from "../../contract/automations";
import { schedules, statusOf, triggers } from "./fixtures";

export const AT = "2026-11-21T20:40:00.000Z";
/** What OATS 0.70.0 says of itself, as far as Automations reads it. */
export const OATS = { version: "0.70.0", features: ["automations", "automation-descriptions", "trigger-sources"], automationsApi: 1 };

const unexpected = (method: string) => (): never => {
  throw new Error(`unexpected rpc ${method}`);
};

export const defaults = (): PluginRpcTestHandlers<typeof rpc> => ({
  automations: () => ({ at: AT, hostId: "host_falcon", oats: OATS, schedule: { ok: true as const, list: schedules() }, trigger: { ok: true as const, list: triggers() } }),
  triggerStatus: ({ id }) => statusOf(id),
  // A test names the acts it is about; one it did not expect fails it.
  automationEnable: unexpected("automationEnable"),
  scheduleRun: unexpected("scheduleRun"),
  automationTest: unexpected("automationTest"),
  automationDescribe: unexpected("automationDescribe"),
  scheduleRemove: unexpected("scheduleRemove"),
  scheduleReconcile: unexpected("scheduleReconcile"),
  schedulerEnable: unexpected("schedulerEnable"),
  // The form's reads answer what the recording's deployment holds; its saves are a test's own.
  scheduleTargets: () => TARGETS,
  scheduleSoulBackends: () => ({ backends: ["bb"] }),
  scheduleHomeOperations: () => ({ operations: [{ address: "knowledge:checkpoint", label: "knowledge: checkpoint — Record this instance's checkpoint" }] }),
  scheduleDraft: unexpected("scheduleDraft"),
  scheduleAdd: unexpected("scheduleAdd"),
  scheduleUpdate: unexpected("scheduleUpdate"),
});

/** The souls and the homes of the recording's deployment, as the form chooses among them. */
export const KEEPER_HOME = "/abs/deployment/agents/note-keeper/instances/team-notes-keeper";
export const TARGETS = {
  souls: [
    { key: "oats-developer", description: "Builds and proves one spec.", spawnable: true },
    { key: "oats-product-expert", description: "Owns the product's direction.", spawnable: true },
    { key: "note-keeper", description: "Keeps the team's notes.", spawnable: true },
  ],
  homes: [
    { instance: "team-notes-keeper", soul: "note-keeper", home: KEEPER_HOME, backend: "bb" },
    { instance: "oats-developer-review-202611212017", soul: "oats-developer", home: "/abs/deployment/agents/oats-developer/instances/oats-developer-review-202611212017", backend: "bb" },
  ],
};
