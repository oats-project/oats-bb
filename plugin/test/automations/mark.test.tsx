// @vitest-environment jsdom
// The Automations row of the sidebar's block (D-037: the row and where it leads) and its failed-run
// mark (D-038). The selection of the open page's row is not here: the sidebar gets it with the
// roster's own change (a page will say it is open with `useOpenPage`).
import { afterEach, expect, test } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { handlers, loadApp, resetApp, sidebarThreads } from "../helpers/render";
import type { Contract, Handlers } from "../helpers/render";
import { AT, OATS } from "./handlers";
import { schedules, triggers } from "./fixtures";

afterEach(resetApp);

async function sidebar(over: Partial<Handlers> = {}) {
  const app = await loadApp();
  return renderSlot<PluginThreadListProps, Contract>(app.threadLists[0]!, { activeThreadId: null, onNavigate: () => undefined } as PluginThreadListProps, { rpc: handlers(over), sidebarThreads: sidebarThreads() });
}
const lists = (schedule = schedules()) => () => ({ at: AT, hostId: "host_falcon", oats: OATS, schedule: { ok: true as const, list: schedule }, trigger: { ok: true as const, list: triggers() } });
const mark = (row: HTMLElement) => row.querySelector('[data-testid="oats-mark"]');

test("Automations is a row of the block, under Workspace, and opens its page", async () => {
  const slot = await sidebar();
  const row = await slot.findByTestId("oats-page-link-automations");
  expect(Array.from(slot.container.querySelectorAll('[data-testid^="oats-page-link-"]')).map((link) => link.textContent)).toEqual(["Workspace", "Automations"]);
  fireEvent.click(row);
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "automations" }]);
});

test("while a schedule's last run is launch failed or invalid, the row carries a dot announced as a failed run", async () => {
  // The recording holds two: a launch the provider refused and an invalid definition.
  const slot = await sidebar({ automations: lists() });
  const row = await slot.findByTestId("oats-page-link-automations");
  await waitFor(() => expect(mark(row)).not.toBeNull());
  expect([mark(row)!.getAttribute("role"), mark(row)!.getAttribute("aria-label")]).toEqual(["img", "Automations, a run failed"]);
});

test("with no failed last run there is no mark: an unknown state and a trigger's fire do not mark", async () => {
  const calm = schedules();
  const slot = await sidebar({ automations: lists({ ...calm, rows: calm.rows.filter((row) => row.name !== "hourly-check" && row.name !== "legacy-herdr") }) });
  const row = await slot.findByTestId("oats-page-link-automations");
  await waitFor(() => expect(slot.inspection.rpcCalls.map((call) => call.method)).toContain("automations"));
  expect(mark(row)).toBeNull();
});

test("lists that cannot be read leave the row without a mark, and the sidebar as it is", async () => {
  const refused = { ok: false as const, code: "E_SCHEDULE_INVALID", message: "oats-schedules.json cannot be read" };
  const slot = await sidebar({ automations: () => ({ at: AT, hostId: "host_falcon", oats: OATS, schedule: refused, trigger: refused }) });
  const row = await slot.findByTestId("oats-page-link-automations");
  await waitFor(() => expect(slot.inspection.rpcCalls.map((call) => call.method)).toContain("automations"));
  expect(mark(row)).toBeNull();
  expect(slot.getByTestId("oats-tree")).toBeTruthy();
});
