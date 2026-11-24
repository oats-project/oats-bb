// @vitest-environment jsdom
// An agent whose bb thread FAILED AT ITS START: it never ran. bb's record of the thread and its
// sidebar say "error" for it as for a thread whose later turn failed; bb's EVENTS tell them apart
// (app/outside/threads.ts). From that one fact: "Failed" in every place, bb's reason under
// Details, Start and Retire, and never that a message carries it on.
// The events are RECORDED (test/fixtures/outside/events/*.json: the pi run's probe), and so is the
// kernel's row of such a home (test/fixtures/outside/status-failed-at-start.json: the pi run's P6).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useState } from "react";
import { afterEach, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import type { ExperimentalThreadHeaderRowProps, PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { refusal } from "../../app/home/board";
import { carriesOn } from "../../app/lifecycle/words";
import { said } from "../../app/outside/say";
import { ERRORED, STARTED, startFailureOf, useStartFailures } from "../../app/outside/threads";
import { agentStatus } from "../../app/roster/status";
import { notified } from "../../app/ui";
import { messageResumes, rest } from "../../model/rest";
import type { Agent, BbThread } from "../../model/types";
import { state } from "../../model/view";
import { fixtureAgents, fixtureThreads } from "../helpers/fixtures";
import { handlers, loadApp, resetApp } from "../helpers/render";
import type { Contract } from "../helpers/render";
import { failedAtStartRow } from "./rows";

afterEach(resetApp);

type Event = { type: string; seq: number; data: Record<string, unknown> };
const events = (name: "never-started" | "ran-then-stopped" | "later-turn-failed"): Event[] => JSON.parse(readFileSync(resolve(process.cwd(), `test/fixtures/outside/events/${name}.json`), "utf8"));
const of = (all: Event[], type: string) => all.filter((event) => event.type === type);
const REASON = 'Failed to resolve Pi model "nosuchmodel"';

const HARVEST = "harvest-knowledge-helper"; // on thr_harvest
/** The kernel's row of a home whose thread failed at its start: not running, "stopped", its session "lost". */
const lostRow = (agent: Agent): Agent => (agent.instance === HARVEST ? { ...agent, running: false, runtimeState: "stopped", sessionEnd: "lost", waiting: null } : agent);
const agents = () => fixtureAgents().map(lostRow);
const harvest = () => agents().find((agent) => agent.instance === HARVEST)!;
/** bb's sidebar with the agent's thread in "error", as bb lists it for a start that failed and for a later turn that failed alike. */
const threads = () => ({ status: "ready" as const, threads: fixtureThreads().map((thread) => (thread.id === "thr_harvest" ? { ...thread, status: "error" as const } : thread)) });
const thread = (): BbThread => threads().threads.find((each) => each.id === "thr_harvest")!;

type Asked = { threadId: string; types?: readonly string[]; order?: string; limit?: string };
/** bb's own answer for a thread's events, by the types asked: the recorded events of that type. */
function bb(recorded: Event[] | Error) {
  const asked: Asked[] = [];
  const list = async (args: Asked) => {
    asked.push(args);
    if (recorded instanceof Error) throw recorded;
    return recorded.filter((event) => args.types === undefined || args.types.includes(event.type));
  };
  return { asked, sdk: { threads: { events: { list }, list: async () => [], interactions: { list: async () => [] } } } as never as RenderSlotOptions<Contract>["sdk"] };
}

test("the rule, on the three recorded threads: an error and never a turn is a thread that failed at its start", () => {
  const [never, lost, later] = [events("never-started"), events("ran-then-stopped"), events("later-turn-failed")];
  expect(startFailureOf(of(never, STARTED), of(never, ERRORED))).toEqual({ message: "Command thread.start failed", detail: REASON });
  expect(startFailureOf(of(lost, STARTED), of(lost, ERRORED))).toBeNull();
  expect(startFailureOf(of(later, STARTED), of(later, ERRORED))).toBeNull();
  // Not by the error alone: a thread that started a turn and has an error did not fail at its start.
  expect(startFailureOf(of(lost, STARTED), of(never, ERRORED))).toBeNull();
  // Nor by the absence of a turn alone (a thread still starting).
  expect(startFailureOf([], [])).toBeNull();
  // bb's last error is the one said; an error with no detail keeps bb's message.
  expect(startFailureOf([], [{ seq: 3, data: { message: "first", detail: "old" } }, { seq: 9, data: { message: "Command thread.start failed" } }])).toEqual({ message: "Command thread.start failed", detail: null });
});

test("one reading of the row: it never ran, so it is failed, it is not carried on by a message, and nothing of the lost session is said", () => {
  const agent = harvest();
  const failed = { ...thread(), startFailure: { message: "Command thread.start failed", detail: REASON } };
  // The same row on a thread whose later turn failed (no word of its start): a lost session, as before.
  expect([rest(agent, thread()), state(agent, thread()), messageResumes(agent, thread())]).toEqual(["lost", "stopped", true]);
  expect(said(agent, "open", true, thread())?.kind).toBe("lost-open");
  // On the thread that failed at its start.
  expect([rest(agent, failed), state(agent, failed), messageResumes(agent, failed)]).toEqual(["never-started", "error", false]);
  expect(agentStatus(agent, failed, 0)).toEqual({ state: "error", word: "Failed", since: null, detail: null, kernel: null, bb: REASON });
  expect(said(agent, "open", true, failed)).toBeNull();
  // The Start dialog says no carry-on line, and the home's card does not answer it.
  expect(carriesOn({ running: agent.running, runtimeState: agent.runtimeState, sessionEnd: agent.sessionEnd ?? null }, failed)).toBe(false);
  expect(refusal(agent, failed)).toBe("stopped");
  // With no detail from bb, its message is the reason.
  expect(agentStatus(agent, { ...failed, startFailure: { message: "Command thread.start failed", detail: null } }, 0).bb).toBe("Command thread.start failed");
  // Never of an agent the kernel says runs (started again since), nor of one on tmux.
  expect(rest({ ...agent, running: true, runtimeState: "unknown" }, failed)).toBe("runs");
  expect(state({ ...agent, running: true, runtimeState: "unknown" }, failed)).not.toBe("error");
  expect(rest({ ...agent, backend: "tmux" }, failed)).toBe("lost");
  // Nor of one the kernel REPORTS running in a home OATS recorded stopped (its row stays not running): "Running outside OATS", with its notice.
  const outside = { ...agent, sessionEnd: "stopped", outsideOats: { code: "running-outside-oats" as const, backend: "bb", message: "a harness runs" } };
  expect([state(outside, failed), rest(outside, failed), said(outside, "open", true, failed)?.kind]).toEqual(["outside", "stopped", "outside"]);
});

test("a read bb fails after it said that a thread failed at its start keeps that answer, and asks again", async () => {
  let fail = false;
  const asked: string[] = [];
  const list = async (args: Asked) => {
    asked.push(args.threadId);
    if (fail) throw new Error("bb is away");
    return events("never-started").filter((event) => args.types!.includes(event.type));
  };
  function Probe() {
    const [token, setToken] = useState("t1");
    const answers = useStartFailures(["thr_a"], token);
    return (
      <button data-testid="probe" onClick={() => setToken((now) => `${now}+`)}>
        {JSON.stringify([...answers])}
      </button>
    );
  }
  const slot = renderSlot<Record<string, never>, Contract>({ component: Probe }, {}, { rpc: handlers(), sdk: { threads: { events: { list } } } as never });
  const said = () => slot.getByTestId("probe").textContent;
  const FAILED = JSON.stringify([["thr_a", { message: "Command thread.start failed", detail: REASON }]]);
  await waitFor(() => expect(said()).toBe(FAILED));
  // The next roster read, or the next minute: bb cannot answer.
  fail = true;
  fireEvent.click(slot.getByTestId("probe"));
  await waitFor(() => expect(asked.length).toBe(4));
  expect(said()).toBe(FAILED);
  // And once bb answers again, its answer is the one kept.
  fail = false;
  fireEvent.click(slot.getByTestId("probe"));
  await waitFor(() => expect(asked.length).toBe(6));
  expect(said()).toBe(FAILED);
});

test("the REAL kernel's row of such a home (recorded) is a lost session's row: only bb's word of the thread's start makes it \"Failed\"", () => {
  const agent = failedAtStartRow();
  // What the kernel printed: nothing in it says that the agent never ran.
  expect([agent.backend, agent.running, agent.runtimeState, agent.sessionEnd, agent.waiting, agent.outsideOats ?? null]).toEqual(["bb", false, "stopped", "lost", null, null]);
  const listed = { ...thread(), id: agent.threadId!, status: "error" };
  // By the row and bb's sidebar alone: "Stopped · session lost", carried on by a message.
  expect([state(agent, listed), rest(agent, listed), messageResumes(agent, listed), said(agent, "open", true, listed)?.kind]).toEqual(["stopped", "lost", true, "lost-open"]);
  // With bb's events of that very thread (the error's data as the pi run's P6 asserts and shows it; not a fixture: one system/error, never a turn): Failed, nothing to carry on.
  const failed = { ...listed, startFailure: startFailureOf([], [{ data: { code: "thread_command_failed", message: "Command thread.start failed", detail: 'Failed to resolve Pi model "mock/echo-20261122"' } }]) };
  expect([state(agent, failed), rest(agent, failed), messageResumes(agent, failed), said(agent, "open", true, failed)]).toEqual(["error", "never-started", false, null]);
  expect(agentStatus(agent, failed, 0)).toMatchObject({ word: "Failed", detail: null, bb: 'Failed to resolve Pi model "mock/echo-20261122"' });
});

async function line(options: RenderSlotOptions<Contract>) {
  const app = await loadApp();
  const Row = app.threadHeaderRows[0]!.component;
  const Overlay = app.appOverlays[0]!.component;
  const slot = renderSlot<ExperimentalThreadHeaderRowProps, Contract>(
    {
      component: function Thread(props: ExperimentalThreadHeaderRowProps) {
        return (
          <>
            <Row {...props} />
            <Overlay />
          </>
        );
      },
    },
    { threadId: "thr_harvest", projectId: "proj_x", environment: null },
    options,
  );
  await slot.findByTestId("oats-identity-row");
  return slot;
}
const words = (slot: Awaited<ReturnType<typeof line>>) => {
  const status = within(slot.getByTestId("oats-identity-row")).getByTestId("oats-status-line");
  return [within(status).getByTestId("oats-state").textContent, ...within(status).queryAllByTestId("oats-status-part").map((part) => part.textContent!.replace(/^· /, ""))];
};
const ACT = '[data-testid="oats-status-act"], [data-testid^="oats-agent-act-"]';
const actsIn = (place: HTMLElement) => Array.from(place.querySelectorAll(ACT)).map((button) => button.textContent);

test("the thread's line: \"Failed\" alone, bb's reason under Details, and Start; bb is asked by type only, never for the thread's whole log", async () => {
  const { asked, sdk } = bb(events("never-started"));
  const slot = await line({ rpc: handlers({}, agents()), sidebarThreads: threads(), sdk });
  await waitFor(() => expect(words(slot)).toEqual(["Failed"]));
  expect(actsIn(slot.getByTestId("oats-identity-row"))).toEqual(["Start"]);
  const details = slot.getByTestId("oats-status-bb");
  expect(details.querySelector("summary")!.textContent).toMatch(/Details$/);
  expect(details.querySelector("p")!.textContent).toBe(`bb says: ${REASON}`);
  expect(slot.queryByTestId("oats-status-kernel")).toBeNull();
  // The read: of this one thread, each time with exactly ONE of the two types the rule reads (the
  // unfiltered log carries the thread's environment: it is never asked for), one event each.
  expect(asked.length).toBeGreaterThan(0);
  expect([...new Set(asked.map((args) => args.threadId))]).toEqual(["thr_harvest"]);
  expect([...new Set(asked.map((args) => JSON.stringify(args.types)))].sort()).toEqual([JSON.stringify([ERRORED]), JSON.stringify([STARTED])]);
  expect([STARTED, ERRORED]).toEqual(["turn/started", "system/error"]);
  expect(asked.every((args) => args.limit === "1")).toBe(true);
  // The Restart key on it: nothing runs, so it says to start it, and opens no dialog.
  const { commands } = await import("../../app/lifecycle");
  await commands.find((each) => each.id === "agent-restart")!.run({ threadId: "thr_harvest", projectId: null, experimental_panel: {} as never });
  expect(notified().at(-1)).toMatchObject({ tone: "hint", title: "Harvest knowledge helper is stopped: Start it instead." });
  expect(slot.queryByRole("dialog")).toBeNull();
});

test("a thread in \"error\" that started a turn (the recorded events of a thread whose later turn failed, and of one that ran a turn) reads as before: \"Stopped · session lost\", carried on by a message", async () => {
  for (const name of ["later-turn-failed", "ran-then-stopped"] as const) {
    const { asked, sdk } = bb(events(name));
    const slot = await line({ rpc: handlers({}, agents()), sidebarThreads: threads(), sdk });
    await waitFor(() => expect(asked.length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(words(slot)[0]).toBe("Stopped"));
    expect(words(slot).join(" ")).toMatch(/send it a message here/);
    expect(slot.queryByTestId("oats-status-bb")).toBeNull();
    resetApp();
  }
});

test("where bb cannot answer for the thread's events, and for a thread that is not in \"error\", the row says what it says without them", async () => {
  const failing = bb(new Error("bb is away"));
  const slot = await line({ rpc: handlers({}, agents()), sidebarThreads: threads(), sdk: failing.sdk });
  await waitFor(() => expect(failing.asked.length).toBeGreaterThanOrEqual(2));
  expect(words(slot)[0]).toBe("Stopped");
  expect(slot.queryByTestId("oats-status-bb")).toBeNull();
  resetApp();
  // A thread bb does not call failed is never asked about.
  const idle = bb(events("never-started"));
  const calm = await line({ rpc: handlers({}, agents()), sidebarThreads: { status: "ready", threads: fixtureThreads() }, sdk: idle.sdk });
  await waitFor(() => expect(words(calm)[0]).toBe("Stopped"));
  expect(idle.asked).toEqual([]);
});

test("the sidebar's row says \"Failed\" and the soul, never \"session lost\"", async () => {
  const { sdk } = bb(events("never-started"));
  const app = await loadApp();
  const slot = renderSlot<PluginThreadListProps, Contract>(app.threadLists[0]!, { activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate: () => undefined, searchQuery: "" }, { rpc: handlers({}, agents()), sidebarThreads: threads(), sdk });
  await slot.findByTestId("oats-tree");
  const facts = () => within(slot.getAllByTestId("oats-agent-row").find((each) => each.getAttribute("data-sidebar-thread-id") === "thr_harvest")!).getByTestId("oats-row-facts").textContent;
  await waitFor(() => expect(facts()).toMatch(/^Failed · /));
  expect(facts()).not.toMatch(/session lost/);
});

test("the agent's own page: \"Failed\", bb's reason under Details, Start… and Retire… and no Restart, and nothing of a lost session", async () => {
  const { sdk } = bb(events("never-started"));
  const app = await loadApp();
  const Overlay = app.appOverlays[0]!.component;
  const Page = app.navPanels.find((candidate) => candidate.id === "agent")!.component;
  const slot = renderSlot<{ subPath: string }, Contract>(
    {
      component: function AgentPage(props: { subPath: string }) {
        return (
          <>
            <Page {...props} />
            <Overlay />
          </>
        );
      },
    },
    { subPath: HARVEST },
    { rpc: handlers({}, agents()), sidebarThreads: threads(), sdk },
  );
  const head = await slot.findByTestId("oats-panel-header");
  await waitFor(() => expect(within(within(head).getByTestId("oats-panel-state")).getByTestId("oats-state").textContent).toBe("Failed"));
  expect(within(head).getByTestId("oats-panel-state").querySelectorAll('[data-testid="oats-status-part"]').length).toBe(0);
  expect(within(head).getByTestId("oats-status-bb").querySelector("p")!.textContent).toBe(`bb says: ${REASON}`);
  expect(actsIn(within(head).getByTestId("oats-agent-acts"))).toEqual(["Start…", "Retire…"]);
  expect(slot.queryByTestId("oats-outside-agent-block")).toBeNull();
  // Start's dialog says no carry-on line: there is no conversation to carry on.
  fireEvent.click(within(head).getByTestId("oats-agent-act-start"));
  const dialog = await slot.findByRole("dialog");
  await waitFor(() => expect(dialog.textContent).toMatch(/Start/));
  expect(dialog.textContent).not.toMatch(/send it a message|carry on/i);
});
