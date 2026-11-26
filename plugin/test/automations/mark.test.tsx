// @vitest-environment jsdom
// The Automations row of the sidebar's block (D-037: the row and where it leads) and its failed-run
// mark (D-038). The selection of the open page's row is not here: the sidebar gets it with the
// roster's own change (a page will say it is open with `useOpenPage`).
import { afterEach, expect, test } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { fixtureAgents, fixtureSnapshot } from "../helpers/fixtures";
import { handlers, loadApp, resetApp, sidebarThreads } from "../helpers/render";
import type { Contract, Handlers } from "../helpers/render";
import { AT, OATS, STATUSES } from "./handlers";
import { schedules, triggers } from "./fixtures";

afterEach(resetApp);

async function sidebar(over: Partial<Handlers> = {}) {
  const app = await loadApp();
  return renderSlot<PluginThreadListProps, Contract>(app.threadLists[0]!, { activeThreadId: null, onNavigate: () => undefined } as PluginThreadListProps, { rpc: handlers(over), sidebarThreads: sidebarThreads() });
}
const lists = (schedule = schedules(), trigger = triggers(), statuses = STATUSES()) => () => ({ at: AT, hostId: "host_falcon", oats: OATS, statuses, schedule: { ok: true as const, list: schedule }, trigger: { ok: true as const, list: trigger } });
/** The recording without what is failing in it: a refused launch, an invalid definition, a wrong account, a schedule not trusted, and a trigger whose source check failed. */
const FAILING = ["local/hourly-check", "local/legacy-herdr", "oats-real/reconcile", "oats-real/release-check", "oats-real/harvest-closed"];
const calm = <List extends { rows: { id: string }[] }>(list: List): List => ({ ...list, rows: list.rows.filter((row) => !FAILING.includes(row.id)) });
const mark = (row: HTMLElement) => row.querySelector('[data-testid="oats-mark"]');

test("Automations is a row of the block, under Workspace, and opens its page", async () => {
  const slot = await sidebar();
  const row = await slot.findByTestId("oats-page-link-automations");
  expect(Array.from(slot.container.querySelectorAll('[data-testid^="oats-page-link-"]')).map((link) => link.textContent)).toEqual(["Workspace", "Automations"]);
  fireEvent.click(row);
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "automations" }]);
});

test("while an automation is failing, the row carries a dot announced as a failure", async () => {
  // The recording holds five that are.
  const slot = await sidebar({ automations: lists() });
  const row = await slot.findByTestId("oats-page-link-automations");
  await waitFor(() => expect(mark(row)).not.toBeNull());
  expect([mark(row)!.getAttribute("role"), mark(row)!.getAttribute("aria-label")]).toEqual(["img", "Automations, a failure"]);
});

test("with nothing failing there is no mark: an unknown state and a trigger's fire do not mark", async () => {
  const slot = await sidebar({ automations: lists(calm(schedules()), calm(triggers())) });
  const row = await slot.findByTestId("oats-page-link-automations");
  await waitFor(() => expect(slot.inspection.rpcCalls.map((call) => call.method)).toContain("automations"));
  expect(mark(row)).toBeNull();
});

test("a trigger's failed poll alone marks, as its row's red line does", async () => {
  const slot = await sidebar({ automations: lists(calm(schedules()), calm(triggers("trigger-list-poll-failed.json")), STATUSES("trigger-status-poll-failed.json")) });
  const row = await slot.findByTestId("oats-page-link-automations");
  await waitFor(() => expect(mark(row)).not.toBeNull());
  expect(mark(row)!.getAttribute("aria-label")).toBe("Automations, a failure");
});

test("each kind of failing row marks by itself: one schedule that is not trusted, with every trigger calm", async () => {
  const one = schedules();
  const slot = await sidebar({ automations: lists({ ...one, rows: one.rows.filter((row) => !FAILING.includes(row.id) || row.id === "oats-real/release-check") }, calm(triggers())) });
  const row = await slot.findByTestId("oats-page-link-automations");
  await waitFor(() => expect(mark(row)).not.toBeNull());
});

test("lists that cannot be read leave the row without a mark, and the sidebar as it is", async () => {
  const refused = { ok: false as const, code: "E_SCHEDULE_INVALID", message: "oats-schedules.json cannot be read" };
  const slot = await sidebar({ automations: () => ({ at: AT, hostId: "host_falcon", oats: OATS, statuses: refused, schedule: refused, trigger: refused }) });
  const row = await slot.findByTestId("oats-page-link-automations");
  await waitFor(() => expect(slot.inspection.rpcCalls.map((call) => call.method)).toContain("automations"));
  expect(mark(row)).toBeNull();
  expect(slot.getByTestId("oats-tree")).toBeTruthy();
});

test("while an agent an automation made asks, the row carries an amber dot, before the red one: one rule, two results", async () => {
  // The recorded run of daily-review, made by an agent the roster says needs a person.
  const list = schedules();
  const asks = { ...list, rows: list.rows.map((row) => (row.id === "local/daily-review" ? { ...row, recentRuns: row.recentRuns.map((run) => ({ ...run, instance: "release-070-maintainer" })) } : row)) };
  const slot = await sidebar({ automations: lists(asks) });
  const row = await slot.findByTestId("oats-page-link-automations");
  const marks = () => Array.from(row.querySelectorAll<HTMLElement>('[data-testid="oats-mark"]')).map((dot) => [dot.getAttribute("aria-label"), dot.dataset.tone ?? "failure"]);
  await waitFor(() => expect(marks()).toEqual([["Automations, needs you", "warning"], ["Automations, a failure", "failure"]]));
  resetApp();
  // With nothing failing, the amber one alone.
  const calmSlot = await sidebar({ automations: lists(calm(asks), calm(triggers())) });
  const calmRow = await calmSlot.findByTestId("oats-page-link-automations");
  await waitFor(() => expect(Array.from(calmRow.querySelectorAll('[data-testid="oats-mark"]')).map((dot) => dot.getAttribute("aria-label"))).toEqual(["Automations, needs you"]));
});

test("the amber dot is by the row's own rule: an agent that runs outside OATS is told as that, not as asking, though it has a claim", async () => {
  const list = schedules();
  const asks = { ...list, rows: list.rows.map((row) => (row.id === "local/daily-review" ? { ...row, recentRuns: row.recentRuns.map((run) => ({ ...run, instance: "release-070-maintainer" })) } : row)) };
  const report = { code: "running-outside-oats" as const, backend: "bb", message: "a harness runs in release-070-maintainer on bb, and OATS recorded this instance stopped" };
  const agents = fixtureAgents().map((agent) => (agent.instance === "release-070-maintainer" ? { ...agent, sessionEnd: "stopped" as const, outsideOats: report } : agent));
  const app = await loadApp();
  const slot = renderSlot<PluginThreadListProps, Contract>(app.threadLists[0]!, { activeThreadId: null, onNavigate: () => undefined } as PluginThreadListProps, { rpc: handlers({ automations: lists(calm(asks), calm(triggers())) }, agents), sidebarThreads: sidebarThreads() });
  const row = await slot.findByTestId("oats-page-link-automations");
  await waitFor(() => expect(slot.inspection.rpcCalls.map((call) => call.method)).toContain("automations"));
  await slot.findByTestId("oats-tree");
  expect(mark(row)).toBeNull();
});

test("with every trigger's state refused while the lists stand, the marks are what the lists alone say: a failing schedule still marks, and nothing is claimed of a trigger", async () => {
  const refused = { ok: false as const, code: "E_TRIGGER_STATE", message: "the trigger state cannot be read" };
  const answer = (schedule = schedules()) => () => ({ at: AT, hostId: "host_falcon", oats: OATS, statuses: refused, schedule: { ok: true as const, list: schedule }, trigger: { ok: true as const, list: calm(triggers("trigger-list-poll-failed.json")) } });
  const slot = await sidebar({ automations: answer() });
  const row = await slot.findByTestId("oats-page-link-automations");
  await waitFor(() => expect(mark(row)).not.toBeNull());
  expect(mark(row)!.getAttribute("aria-label")).toBe("Automations, a failure");
  resetApp();
  // The trigger whose POLL failed is not known to fail without its state (the poll is in the state): with every schedule
  // calm, and no trigger that fails by its list's row, there is no mark.
  const calmSlot = await sidebar({ automations: answer(calm(schedules())) });
  const calmRow = await calmSlot.findByTestId("oats-page-link-automations");
  await waitFor(() => expect(calmSlot.inspection.rpcCalls.map((call) => call.method)).toContain("automations"));
  await calmSlot.findByTestId("oats-tree");
  expect(mark(calmRow)).toBeNull();
  resetApp();
  // A trigger that fails BY ITS ROW (the recorded one whose source's check failed at a poll) needs no state to be failing:
  // the page draws it red and counts it, and so the link carries the red dot, by the same rule.
  const byRow = triggers().rows.filter((row) => row.id === "oats-real/harvest-closed");
  expect(byRow.map((row) => row.invalid !== null)).toEqual([true]);
  const rowSlot = await sidebar({ automations: () => ({ at: AT, hostId: "host_falcon", oats: OATS, statuses: refused, schedule: { ok: true as const, list: calm(schedules()) }, trigger: { ok: true as const, list: triggers() } }) });
  const rowLink = await rowSlot.findByTestId("oats-page-link-automations");
  await waitFor(() => expect(mark(rowLink)?.getAttribute("aria-label")).toBe("Automations, a failure"));
});

test("a later read of every trigger's state that is refused keeps the state read before, for the marks as for the page: the amber dot follows the roster, not a frozen verdict", async () => {
  // The recorded fire of pr-triage made an agent; the roster says it asks. First read: the states; every read after: refused.
  const fired = STATUSES().statuses.find((entry) => entry.id === "local/pr-triage")!.status.fired[0]!;
  const agents = fixtureAgents();
  const asks = agents.find((agent) => agent.waiting !== null)!;
  const states = { ok: true as const, statuses: STATUSES().statuses.map((entry) => (entry.id === "local/pr-triage" ? { id: entry.id, status: { ...entry.status, fired: [{ ...fired, instance: asks.instance }] } } : entry)) };
  let reads = 0;
  let answered = false;
  const app = await loadApp();
  const slot = renderSlot<PluginThreadListProps, Contract>(app.threadLists[0]!, { activeThreadId: null, onNavigate: () => undefined } as PluginThreadListProps, {
    rpc: handlers({
      automations: () => ({ at: AT, hostId: "host_falcon", oats: OATS, statuses: (reads += 1) === 1 ? states : { ok: false as const, code: "E_TRIGGER_STATE", message: "the trigger state cannot be read" }, schedule: { ok: true as const, list: calm(schedules()) }, trigger: { ok: true as const, list: calm(triggers()) } }),
      // Once the person has answered, the roster says the agent asks no more.
      snapshot: () => fixtureSnapshot(answered ? agents.map((agent) => (agent.instance === asks.instance ? { ...agent, waiting: null } : agent)) : agents),
    }),
    sidebarThreads: { ...sidebarThreads(), threads: sidebarThreads().threads.map((thread) => ({ ...thread, hasPendingInteraction: false })) },
  });
  const row = await slot.findByTestId("oats-page-link-automations");
  await waitFor(() => expect(mark(row)?.getAttribute("aria-label")).toBe("Automations, needs you"));
  // The state is refused from here on: the kept state still says which agent the trigger made, so the dot stands while that agent asks…
  await slot.behavior.emitRealtime("oats/changed", { at: "2026-11-21T20:50:00.000Z" });
  await waitFor(() => expect(reads).toBeGreaterThan(1));
  expect(mark(row)?.getAttribute("aria-label")).toBe("Automations, needs you");
  // …and goes once it is answered, though the state is still refused: the verdict is not frozen.
  answered = true;
  await slot.behavior.emitRealtime("oats/changed", { at: "2026-11-21T20:51:00.000Z" });
  await waitFor(() => expect(mark(row)).toBeNull());
});

test("an agent asks by a question its bb thread waits on, too: the amber dot reads the thread bb lists for the agent, not the kernel's row alone", async () => {
  // The recorded run of daily-review, made by an agent with a bb thread and NO claim of the kernel's; its thread waits on a person.
  const quiet = fixtureAgents().find((agent) => agent.threadId !== null && agent.waiting === null && agent.running)!;
  const list = schedules();
  const made = { ...list, rows: list.rows.map((row) => (row.id === "local/daily-review" ? { ...row, recentRuns: row.recentRuns.map((run) => ({ ...run, instance: quiet.instance })) } : row)) };
  const amber = async (pending: boolean) => {
    const app = await loadApp();
    const threads = sidebarThreads();
    const slot = renderSlot<PluginThreadListProps, Contract>(app.threadLists[0]!, { activeThreadId: null, onNavigate: () => undefined } as PluginThreadListProps, { rpc: handlers({ automations: lists(calm(made), calm(triggers())) }), sidebarThreads: { ...threads, threads: threads.threads.map((thread) => (thread.id === quiet.threadId ? { ...thread, hasPendingInteraction: pending } : { ...thread, hasPendingInteraction: false })) } });
    const row = await slot.findByTestId("oats-page-link-automations");
    await slot.findByTestId("oats-tree");
    await waitFor(() => expect(slot.inspection.rpcCalls.map((call) => call.method)).toContain("automations"));
    return { row, slot };
  };
  const waits = await amber(true);
  await waitFor(() => expect(mark(waits.row)?.getAttribute("aria-label")).toBe("Automations, needs you"));
  resetApp();
  const calmly = await amber(false);
  expect(mark(calmly.row)).toBeNull();
});
