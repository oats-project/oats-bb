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
  automations: () => ({ at: AT, hostId: "host_checks", oats: OATS, schedule: { ok: true as const, list: schedules() }, trigger: { ok: true as const, list: triggers() } }),
  triggerStatus: ({ id }) => statusOf(id),
  // A test names the acts it is about; one it did not expect fails it.
  automationEnable: unexpected("automationEnable"),
  scheduleRun: unexpected("scheduleRun"),
  automationTest: unexpected("automationTest"),
  automationDescribe: unexpected("automationDescribe"),
  scheduleRemove: unexpected("scheduleRemove"),
  scheduleReconcile: unexpected("scheduleReconcile"),
  schedulerEnable: unexpected("schedulerEnable"),
});
