// The lifecycle's RPC methods: no slot test reaches them unless it is about them. And the answers
// a test of another feature gives for them, in the contract's shape: the recorded answers of the
// real kernel (test/fixtures/lifecycle), read as the host entry reads them.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { rpc } from "../../contract/lifecycle";
import { parseRetireApply, parseRetirePlan, parseSessionStart, parseStopApply, parseStopPlan } from "../../kernel/lifecycle";
import type { RetirePlan, RetireReceipt, StopPlan, StopReceipt } from "../../kernel/lifecycle";
import { FIXTURES } from "../support/fake-oats";
import { unexpected } from "../helpers/unexpected";

export const defaults = (): PluginRpcTestHandlers<typeof rpc> => ({
  stopPlan: unexpected("stopPlan"),
  stopApply: unexpected("stopApply"),
  startCheck: unexpected("startCheck"),
  start: unexpected("start"),
  restart: unexpected("restart"),
  retirePlan: unexpected("retirePlan"),
  retireApply: unexpected("retireApply"),
});

const recorded = (name: string): unknown => {
  const document = JSON.parse(readFileSync(join(FIXTURES, "lifecycle", name), "utf8")) as { result?: unknown };
  return document.result ?? document;
};
const read = <Value>(result: { ok: true; value: Value } | { ok: false; error: { message: string } }): Value => {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

/** The recorded stop plan (redesign-ui-lead and its two children), as the kernel named it or for `instance` alone. */
export function stopPlanOf(instance?: string, providerVersion: string | null = null): StopPlan & { providerVersion: string | null } {
  // The provider's version is read beside the plan by the plugin's server (contract `stopPlanRead`).
  const plan = { ...read(parseStopPlan(recorded("stop-plan.json"))), providerVersion };
  return instance === undefined ? plan : { ...plan, instance, targets: [{ ...plan.targets[0]!, instance }] };
}
export const stopReceiptOf = (): StopReceipt => read(parseStopApply(recorded("stop-apply.json")));
/** The recorded retire plan (weekly-digest-helper, on a worktree, with one child), or the same facts for `instance`. */
export function retirePlanOf(instance?: string, harness: string | null = null): RetirePlan & { harness: string | null } {
  // The harness is the status row's, read beside the plan by the plugin's server (contract `retirePlanRead`).
  const plan = { ...read(parseRetirePlan(recorded("retire-plan.json"))), harness };
  return instance === undefined ? plan : { ...plan, instance };
}
export function retireReceiptOf(instance?: string): RetireReceipt {
  const receipt = read(parseRetireApply(recorded("retire-apply.json")));
  return instance === undefined ? receipt : { ...receipt, instance };
}
/** What a start or a restart answers: the recorded one (weekly-digest-helper), in `threadId`; or the same for `instance`. */
export const startedIn = (threadId: string, instance?: string) => ({ ...read(parseSessionStart(recorded("start.json"))), threadId, ...(instance === undefined ? {} : { instance }) });
/** What the Start and Restart dialogs read before the act, for a stopped agent on Claude Code; `change` what a test is about. */
export const startCheckOf = (instance: string, change: Partial<Awaited<ReturnType<PluginRpcTestHandlers<typeof rpc>["startCheck"]>>> = {}) => ({
  instance,
  machine: "checks-host",
  home: `/abs/deployment/agents/oats-expert/instances/${instance}`,
  harness: "claude",
  model: "claude-opus-5-5",
  running: false as boolean | null,
  runtimeState: "stopped" as string | null,
  runtimeError: null as string | null,
  sessionEnd: "stopped" as string | null,
  backend: "bb" as string | null,
  harnesses: ["claude", "pi"],
  ...change,
});

/** bb's own model list for a harness's provider (`sdk.providers.models`), which the Start dialog asks for its suggestions: none, unless a test names some. */
export const modelsSdk = (models: { model: string; displayName?: string }[] = []) => ({ providers: { models: (async () => ({ models })) as never } });
