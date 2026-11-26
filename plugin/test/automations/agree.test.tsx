// @vitest-environment jsdom
// THE ONE PREDICATE, held where it broke: what is failing and what needs a person is said by the page (a row's state,
// the filter's two counts) and by the sidebar's link (its two dots), and the two must AGREE in every state of the
// reads. They judge by one rule (words.ts `failing`, read.ts `askingOf`) over ONE kept copy of what was read last
// (read.ts `keptOf`) and one reading of who asks (read.ts `agentStates`). Each test here is a state in which the page
// and the dot once disagreed (the delta read of review round 4 found them, each by a run).
import { afterEach, expect, test } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { fixtureAgents, fixtureSnapshot } from "../helpers/fixtures";
import { handlers, loadApp, resetApp, sidebarThreads } from "../helpers/render";
import type { Contract, Handlers } from "../helpers/render";
import { AT, OATS, STATUSES } from "./handlers";
import { schedules, triggers } from "./fixtures";

afterEach(resetApp);
/** The recording without what is failing in it. */
const FAILING = ["local/hourly-check", "local/legacy-herdr", "oats-real/reconcile", "oats-real/release-check", "oats-real/harvest-closed"];
const calm = <List extends { rows: { id: string }[] }>(list: List): List => ({ ...list, rows: list.rows.filter((row) => !FAILING.includes(row.id)) });
const dots = (link: HTMLElement) => Array.from(link.querySelectorAll('[data-testid="oats-mark"]')).map((dot) => dot.getAttribute("aria-label"));
type Threads = ReturnType<typeof sidebarThreads>;
/** The sidebar and the page of ONE window (one app, one copy of every read), as a person has them: the sidebar always, the page when it is opened. */
async function windowOf(over: Partial<Handlers>, threads: Threads = sidebarThreads()) {
  const app = await loadApp();
  const side = renderSlot<PluginThreadListProps, Contract>(app.threadLists[0]!, { activeThreadId: null, onNavigate: () => undefined } as PluginThreadListProps, { rpc: handlers(over), sidebarThreads: threads });
  const link = await side.findByTestId("oats-page-link-automations");
  const openPage = async () => {
    const panel = app.navPanels.find((candidate) => candidate.id === "automations")!;
    const page = renderSlot<{ subPath: string }, Contract>(panel, { subPath: "" }, { rpc: handlers(over), sidebarThreads: threads });
    await page.findAllByTestId("oats-automation-row");
    const states = () => page.getAllByTestId("oats-automation-row").map((row) => row.dataset.state);
    const counts = () => Object.fromEntries(Array.from(page.getByTestId("oats-filter").querySelectorAll('[role="radio"]')).map((pill) => [pill.firstChild?.textContent, Number(pill.lastChild?.textContent)]));
    /** What the page says, in the dot's own two words. */
    const says = () => [...(states().includes("needs") || counts()["Needs you"]! > 0 ? ["Automations, needs you"] : []), ...(states().includes("failing") || counts().Failing! > 0 ? ["Automations, a failure"] : [])];
    return { page, states, counts, says };
  };
  return { side, link, openPage };
}
const quiet = () => ({ ...sidebarThreads(), threads: sidebarThreads().threads.map((thread) => ({ ...thread, hasPendingInteraction: false })) });

test("every trigger's state read while the page was closed, and refused since: the page that opens draws the triggers by that state, as the dot judges them", async () => {
  // Read 1 has the state of a trigger whose poll failed (nothing else fails); every later read is refused of it.
  let reads = 0;
  const automations = () => ({ at: AT, hostId: "host_falcon", oats: OATS, statuses: (reads += 1) === 1 ? STATUSES("trigger-status-poll-failed.json") : { ok: false as const, code: "E_TRIGGER_STATE", message: "the trigger state cannot be read" }, schedule: { ok: true as const, list: calm(schedules()) }, trigger: { ok: true as const, list: calm(triggers("trigger-list-poll-failed.json")) } });
  const { side, link, openPage } = await windowOf({ automations });
  await waitFor(() => expect(dots(link)).toEqual(["Automations, a failure"]));
  await side.behavior.emitRealtime("oats/changed", { at: "2026-11-21T20:50:00.000Z" });
  await waitFor(() => expect(reads).toBeGreaterThan(1));
  // The person opens the page now: every read it sees is refused of the state.
  const { page, says, counts } = await openPage();
  await page.findByTestId("oats-automations-state-failed");
  await waitFor(() => expect(says()).toEqual(["Automations, a failure"]));
  expect([counts().Failing! > 0, dots(link)]).toEqual([true, ["Automations, a failure"]]);
});

test("a list refused after a good read: its kept rows are judged by the roster of NOW, by the page and by the dot alike: an agent answered since asks no more, in both", async () => {
  const agents = fixtureAgents();
  const list = schedules();
  const asks = calm({ ...list, rows: list.rows.map((row) => (row.id === "local/daily-review" ? { ...row, recentRuns: row.recentRuns.map((run) => ({ ...run, instance: "release-070-maintainer" })) } : row)) });
  let reads = 0;
  let answered = false;
  const over: Partial<Handlers> = {
    automations: () => ({ at: AT, hostId: "host_falcon", oats: OATS, statuses: STATUSES(), schedule: (reads += 1) === 1 ? { ok: true as const, list: asks } : { ok: false as const, code: "E_SCHEDULE_INVALID", message: "oats-schedules.json cannot be read" }, trigger: { ok: true as const, list: calm(triggers()) } }),
    snapshot: () => fixtureSnapshot(answered ? agents.map((agent) => (agent.instance === "release-070-maintainer" ? { ...agent, waiting: null } : agent)) : agents),
  };
  const { side, link, openPage } = await windowOf(over, quiet());
  await waitFor(() => expect(dots(link)).toEqual(["Automations, needs you"]));
  const { page, says } = await openPage();
  await waitFor(() => expect(says()).toEqual(["Automations, needs you"]));
  // The schedules' list is refused from here on, and the person answers the agent.
  // (In bb the sidebar and the page are one window with one copy of each read, and one signal rereads it. The test's
  // harness gives each slot a copy of its own, and the plugin acts on a signal once per window: so each slot is given
  // a signal of its own, a second apart.)
  const changed = async (at: string) => {
    await page.behavior.emitRealtime("oats/changed", { at });
    await side.behavior.emitRealtime("oats/changed", { at: at.replace(":00.000Z", ":01.000Z") });
  };
  answered = true;
  await changed("2026-11-21T20:51:00.000Z");
  await page.findByTestId("oats-automations-failed");
  await waitFor(() => expect([says(), dots(link)]).toEqual([[], []]));
  // And the reverse: it asks again, the list still refused: both say so.
  answered = false;
  await changed("2026-11-21T20:52:00.000Z");
  await waitFor(() => expect([says(), dots(link)]).toEqual([["Automations, needs you"], ["Automations, needs you"]]));
});

test("who asks is read by one function: an agent with no claim whose bb thread waits on a person but is HIDDEN in bb (the tree does not draw it) asks on neither; shown, on both", async () => {
  const agent = fixtureAgents().find((each) => each.threadId !== null && each.waiting === null && each.running)!;
  const list = schedules();
  const made = calm({ ...list, rows: list.rows.map((row) => (row.id === "local/daily-review" ? { ...row, recentRuns: row.recentRuns.map((run) => ({ ...run, instance: agent.instance })) } : row)) });
  const automations = () => ({ at: AT, hostId: "host_falcon", oats: OATS, statuses: STATUSES(), schedule: { ok: true as const, list: made }, trigger: { ok: true as const, list: calm(triggers()) } });
  const threadsWith = (hidden: boolean): Threads => ({ ...sidebarThreads(), threads: sidebarThreads().threads.map((thread) => (thread.id === agent.threadId ? { ...thread, hasPendingInteraction: true, isHidden: hidden } : { ...thread, hasPendingInteraction: false })) });
  const shown = await windowOf({ automations }, threadsWith(false));
  const shownPage = await shown.openPage();
  await waitFor(() => expect([shownPage.says(), dots(shown.link)]).toEqual([["Automations, needs you"], ["Automations, needs you"]]));
  resetApp();
  const hidden = await windowOf({ automations }, threadsWith(true));
  const hiddenPage = await hidden.openPage();
  await hidden.side.findByTestId("oats-tree");
  await waitFor(() => expect(hidden.side.inspection.rpcCalls.map((call) => call.method)).toContain("automations"));
  expect([hiddenPage.says(), dots(hidden.link)]).toEqual([[], []]);
});
