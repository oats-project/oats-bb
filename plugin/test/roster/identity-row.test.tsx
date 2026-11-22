// @vitest-environment jsdom
// A9: the IdentityRow (experimental_threadHeaderRow).
import { recordedEvents } from "../panel/handlers";
import { waitingClock } from "../../app/ui/words";
import { afterEach, expect, test, vi } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import type { ExperimentalThreadHeaderRowProps } from "@get-bb/plugin-sdk/app";
import { setAgentPage } from "../../app/home/agent-tab";
import { fixtureAgents } from "../helpers/fixtures";
import { handlers, loadApp, resetApp, sidebarThreads } from "../helpers/render";
import type { Contract } from "../helpers/render";

afterEach(() => {
  agentPage = null;
  resetApp();
  vi.unstubAllGlobals();
});

// The page of one agent, as these tests name it: none, unless a test gives one. Named after the
// app is loaded, since a feature that has such a page names its own in its `register`.
let agentPage: Parameters<typeof setAgentPage>[0] = null;

async function row(threadId: string, options: RenderSlotOptions<Contract> = {}) {
  const app = await loadApp();
  setAgentPage(agentPage);
  expect(app.threadHeaderRows.map((registration) => registration.id)).toEqual(["identity"]);
  const calls: string[] = [];
  const rpc = handlers();
  const slot = renderSlot<ExperimentalThreadHeaderRowProps, Contract>(
    app.threadHeaderRows[0]!,
    { threadId, projectId: "proj_x", environment: null },
    {
      rpc: { ...rpc, snapshot: (input) => (calls.push("snapshot"), rpc.snapshot(input)) },
      sidebarThreads: sidebarThreads(),
      ...options,
    },
  );
  // the row draws nothing until the snapshot is in: wait for the read, then one more turn
  await vi.waitFor(() => expect(calls).toEqual(["snapshot"]));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return slot;
}

test("nothing for a thread that is no OATS agent", async () => {
  const slot = await row("thr_plain");
  expect(slot.container.innerHTML).toBe("");
});

test("nothing for a thread bb does not list", async () => {
  const slot = await row("thr_unknown");
  expect(slot.container.innerHTML).toBe("");
});

const fact = (slot: Awaited<ReturnType<typeof row>>, id: string) => slot.getByTestId(id).textContent;
const render = async (threadId: string, agents: ReturnType<typeof fixtureAgents>, over: Parameters<typeof handlers>[0] = {}) => {
  const app = await loadApp();
  setAgentPage(agentPage);
  return renderSlot<ExperimentalThreadHeaderRowProps, Contract>(app.threadHeaderRows[0]!, { threadId, projectId: "p", environment: null }, { rpc: handlers(over, agents), sidebarThreads: sidebarThreads() });
};

test("the status line comes first and says where the agent is in words: a working child, with its labelled facts", async () => {
  const slot = await row("thr_mockups", { experimental_panel: { openTab: () => true } });
  const block = await slot.findByTestId("oats-identity-row");
  expect(block.firstElementChild).toBe(slot.getByTestId("oats-status-line"));
  expect(slot.getByTestId("oats-status-line").textContent).toBe("WorkingStopInstance panel"); // the state, then the one row of buttons: the act that applies, and the panel
  const stop = slot.getByTestId("oats-status-act") as HTMLButtonElement;
  expect([stop.textContent, stop.disabled, stop.title]).toEqual(["Stop", false, "Stop this agent through OATS"]);
  // Each fact has its label; the instance is not repeated (the thread's title is it), and there is no "✓".
  expect(fact(slot, "oats-fact-soul")).toBe("instance ofoats-desktop-developer");
  expect(fact(slot, "oats-fact-parent")).toBe("ParentRedesign ui lead");
  expect(fact(slot, "oats-fact-identity")).toBe("Messaging IDdesktop-mockups-developer") // the Desktop's label; no team id in it;
  expect(block.textContent).not.toContain("✓");
  // The parent is a link to its thread; the soul opens the soul's page.
  const parent = slot.getByTestId("oats-fact-parent").querySelector("a")!;
  expect(parent.getAttribute("href")).toBe("/projects/proj_redesign/threads/thr_redesign");
  fireEvent.click(parent);
  const soulLink = slot.getByTestId("oats-fact-soul").querySelector("a")!;
  expect(soulLink.getAttribute("href")).toBe("/plugins/test-plugin/souls/oats-desktop-developer");
  fireEvent.click(soulLink);
  expect(slot.inspection.navigateCalls).toEqual([
    { method: "toThread", threadId: "thr_redesign" },
    { method: "toPluginPanel", path: "souls", options: { subPath: "oats-desktop-developer" } },
  ]);
  // OATS opens the thread's fixed tab.
  fireEvent.click(slot.getByTestId("oats-open-panel"));
  expect(slot.inspection.experimental_panelCalls).toEqual([{ method: "openTab", options: { tab: { id: "home", context: { kind: "thread" }, availability: "fixed" } } }]);
});

test("an agent that needs you: since when and its question, on its own thread", async () => {
  const since = new Date(Date.now() - 12 * 60_000 - 5_000).toISOString();
  const agents = fixtureAgents().map((agent) => (agent.instance === "release-070-maintainer" ? { ...agent, waiting: { reason: "question", message: "Green light at 9f2e1c?", since } } : agent));
  const slot = await render("thr_release", agents);
  const line = await slot.findByTestId("oats-status-line");
  expect(line.getAttribute("data-state")).toBe("needs-you");
  expect(line.textContent).toMatch(/^!Needs you· waiting 12 min \(since \d\d:\d\d\)· Green light at 9f2e1c\?Instance panel$/);
});

test("a stopped agent says Stopped and offers Start, through OATS; one whose session ended offers Restart; one the kernel cannot reach says so in words, with what OATS says under Details, and Retry", async () => {
  // (Its events hold no "stopped" here: the kernel recorded no time, and the line says none.)
  const stopped = await render("thr_digest", fixtureAgents(), { start: () => ({ threadId: "thr_started" }), panelEvents: () => ({ ...recordedEvents(), events: [] }) });
  expect((await stopped.findByTestId("oats-status-line")).textContent).toBe("StoppedStartInstance panel");
  fireEvent.click(stopped.getByTestId("oats-status-act"));
  await vi.waitFor(() => expect(stopped.inspection.rpcCalls.filter((call) => call.method === "start").map((call) => call.input)).toEqual([{ instance: "weekly-digest-helper" }]));
  stopped.unmount();
  const states = fixtureAgents().map((agent) =>
    agent.instance === "harvest-knowledge-helper"
      ? { ...agent, running: false, runtimeState: "shell" }
      : agent.instance === "desktop-mockups-developer"
        ? { ...agent, running: null, runtimeState: "unreachable", runtimeError: "bb did not answer" }
        : agent,
  );
  const failed = await render("thr_harvest", states);
  expect((await failed.findByTestId("oats-status-line")).textContent).toBe("Failed· Its session endedRestartInstance panel");
  failed.unmount();
  const unreachable = await render("thr_mockups", states);
  // A person's words on the line; what the kernel said is one press away, under Details, never the line's words.
  expect((await unreachable.findByTestId("oats-status-line")).textContent).toBe("Unreachable· OATS cannot reach its sessionRetryInstance panel");
  const kernel = unreachable.getByTestId("oats-status-kernel") as HTMLDetailsElement;
  expect(kernel.open).toBe(false);
  expect(kernel.querySelector("p")!.textContent).toBe("OATS says: bb did not answer");
});

test("for a root agent with children: who started it, not a link, and the number of children", async () => {
  const slot = await row("thr_redesign");
  const parent = await slot.findByTestId("oats-fact-parent");
  expect(parent.textContent).toBe("Owning humanjoan");
  expect(parent.querySelector("a")).toBeNull();
  expect(slot.getByTestId("oats-fact-children").textContent).toBe("Children2");
});

test("the address is shown instead of the alias when the row carries one; no identity fact without either", async () => {
  const agents = fixtureAgents().map((agent) =>
    agent.instance === "redesign-ui-lead"
      ? { ...agent, address: "oats.aweb.ai/redesign-ui-lead" }
      : agent.instance === "flaky-ci-developer"
        ? { ...agent, alias: null, team: null, address: null }
        : agent,
  );
  const withAddress = await render("thr_redesign", agents);
  expect((await withAddress.findByTestId("oats-fact-identity")).textContent).toBe("Messaging IDoats.aweb.ai/redesign-ui-lead");
  withAddress.unmount();
  const without = await render("thr_ci", agents);
  await without.findByTestId("oats-fact-soul");
  expect(without.queryByTestId("oats-fact-identity")).toBeNull();
});

test("a parent that is not in bb is named, without a link", async () => {
  const agents = fixtureAgents().map((agent) => (agent.instance === "ranker-v3-probe" ? { ...agent, parent: "kernel-fix-developer" } : agent));
  const slot = await render("thr_research", agents);
  const parent = await slot.findByTestId("oats-fact-parent");
  expect(parent.textContent).toBe("ParentKernel fix developer");
  expect(parent.querySelector("a")).toBeNull();
});

test("where bb declines the tab, OATS opens the home page", async () => {
  const slot = await row("thr_mockups"); // no panel handler: every call declines
  fireEvent.click(await slot.findByTestId("oats-open-panel"));
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "home" }]);
});

test("on a compact viewport OATS navigates to the home page and never asks for the tab", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(max-width: 767px)" }));
  const slot = await row("thr_mockups", { experimental_panel: { openTab: () => true } });
  fireEvent.click(await slot.findByTestId("oats-open-panel"));
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "home" }]);
  expect(slot.inspection.experimental_panelCalls).toEqual([]);
});

test("on a compact viewport, where a feature gives agents a page of their own, OATS opens this agent's page", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(max-width: 767px)" }));
  const opened: string[] = [];
  agentPage = (_navigate, instance) => void opened.push(instance);
  const slot = await row("thr_mockups", { experimental_panel: { openTab: () => true } });
  fireEvent.click(await slot.findByTestId("oats-open-panel"));
  expect(opened).toEqual(["desktop-mockups-developer"]);
  expect(slot.inspection.navigateCalls).toEqual([]);
  expect(slot.inspection.experimental_panelCalls).toEqual([]);
});

test("the block wraps and nothing in it scrolls out of sight or is cut", async () => {
  const slot = await row("thr_mockups");
  const block = await slot.findByTestId("oats-identity-row");
  for (const part of [block, slot.getByTestId("oats-identity-facts"), slot.getByTestId("oats-status-line")]) {
    expect(part.className).not.toMatch(/overflow-x-auto|whitespace-nowrap|truncate/);
  }
  expect(slot.getByTestId("oats-identity-facts").className).toContain("flex-wrap");
  // The status line wraps inside its frame (the frame clips only the strip a separator at a line's start falls in).
  expect(slot.getByTestId("oats-status-line").firstElementChild!.className).toContain("flex-wrap");
});

test("on the last roster read, while OATS cannot be read: the line as last read, its act off with the reason, and under it the one drawing of that: the age, that the acts are held, Retry", async () => {
  const last = { at: new Date(Date.now() - 2 * 60_000 - 5_000).toISOString(), deployment: { root: "/abs/deployment", workspace: "oats", machine: "falcon" }, agents: fixtureAgents() };
  const slot = await render("thr_mockups", fixtureAgents(), { snapshot: () => ({ ok: false, at: new Date().toISOString(), code: "OATS_TIMEOUT", message: "oats did not answer", last }) });
  expect((await slot.findByTestId("oats-status-line")).textContent).toBe("WorkingStopInstance panel");
  // The act that applies is held: in its place, off, with the reason.
  const held = slot.getByTestId("oats-status-act") as HTMLButtonElement;
  expect([held.textContent, held.disabled, held.title]).toEqual(["Stop", true, "Comes back when OATS is read again"]);
  const stale = slot.getByTestId("oats-unreadable");
  expect(stale.getAttribute("data-compact")).toBe("");
  expect(stale.textContent).toBe("OATS did not answer on falconShowing what was read 2 min ago. Press Retry: Stop, Start, Restart, Retire and New agent return when OATS is read again.Retry");
  fireEvent.click(within(stale).getByRole("button", { name: "Retry" }));
  await vi.waitFor(() => expect(slot.inspection.rpcCalls.some((call) => call.method === "refresh")).toBe(true));
  slot.unmount();
  // A stopped agent's Start stays in its place, off, and says when it comes back.
  const stopped = await render("thr_digest", fixtureAgents(), { snapshot: () => ({ ok: false, at: new Date().toISOString(), code: "OATS_TIMEOUT", message: "oats did not answer", last }) });
  const start = (await stopped.findByTestId("oats-status-act")) as HTMLButtonElement;
  expect([start.textContent, start.disabled, start.title]).toEqual(["Start", true, "Comes back when OATS is read again"]);
});

test("with no roster ever read the row says that OATS cannot be read, with Retry: never nothing", async () => {
  const slot = await render("thr_mockups", fixtureAgents(), { snapshot: () => ({ ok: false, at: "t", code: "OATS_NOT_FOUND", message: "oats: not found", last: null }) });
  const block = await slot.findByTestId("oats-identity-row");
  expect(block.textContent).toBe("OATS is not installed on this machineRetry");
  fireEvent.click(slot.getByRole("button", { name: "Retry" }));
  await vi.waitFor(() => expect(slot.inspection.rpcCalls.some((call) => call.method === "refresh")).toBe(true));
});

// The plugin's setting `pages`: where the Souls page is not shown in this release the soul is said
// by its name alone: no link leads to a page that is not there.
test("the soul is a link to its page where that page is shown, and its name alone where it is not", async () => {
  const shownSlot = await row("thr_mockups", { settings: { pages: "home, souls" } });
  expect((await shownSlot.findByTestId("oats-fact-soul")).querySelector("a")).not.toBeNull();
  shownSlot.unmount();
  resetApp();
  const hidden = await row("thr_mockups", { settings: { pages: "home" } });
  const fact = await hidden.findByTestId("oats-fact-soul");
  expect(fact.textContent).toBe("instance ofoats-desktop-developer");
  expect(fact.querySelector("a")).toBeNull();
});

test("a stopped agent says since when from its last recorded \"stopped\" event, read for this thread's agent alone", async () => {
  const slot = await render("thr_digest", fixtureAgents()); // the recorded events: stopped at 2026-11-21T18:23:24.196Z
  await vi.waitFor(() => expect(slot.getByTestId("oats-status-line").textContent).toBe(`Stopped· since ${waitingClock("2026-11-21T18:23:24.196Z")}StartInstance panel`));
  expect(slot.inspection.rpcCalls.filter((call) => call.method === "panelEvents").map((call) => call.input)).toEqual([{ instance: "weekly-digest-helper" }]);
  slot.unmount();
  resetApp();
  // An agent that is not stopped asks for no events.
  const working = await render("thr_mockups", fixtureAgents());
  await working.findByTestId("oats-status-line");
  expect(working.inspection.rpcCalls.some((call) => call.method === "panelEvents")).toBe(false);
});

// The events read runs once and bb keeps its answer: an agent stopped, started and stopped again
// in one window must say the time of THIS stop, never the earlier one's (round 1 of the second pass).
test("a stopped agent that was started and stopped again says the time of this stop: the events are read again each time it turns stopped", async () => {
  const [first, started, second] = ["2026-11-21T10:00:00.000Z", "2026-11-21T12:00:00.000Z", "2026-11-21T16:00:00.000Z"];
  const digest = (over: Partial<ReturnType<typeof fixtureAgents>[number]>) => fixtureAgents().map((agent) => (agent.instance === "weekly-digest-helper" ? { ...agent, ...over } : agent));
  const stop = recordedEvents().events.find((event) => event.kind === "stopped")!;
  let agents = digest({ startedAt: "2026-11-21T09:00:00.000Z" });
  let events = [{ ...stop, at: first }];
  const slot = await render("thr_digest", fixtureAgents(), {
    snapshot: (input) => handlers({}, agents).snapshot(input),
    panelEvents: () => ({ ...recordedEvents(), events }),
  });
  const line = () => slot.getByTestId("oats-status-line").textContent;
  const asked = () => slot.inspection.rpcCalls.filter((call) => call.method === "panelEvents").length;
  await vi.waitFor(() => expect(line()).toBe(`Stopped· since ${waitingClock(first)}StartInstance panel`));
  expect(asked()).toBe(1);
  // Started: the line is no longer the stopped one, and nothing more is asked.
  agents = digest({ running: true, runtimeState: "running", startedAt: started });
  await slot.behavior.emitRealtime("oats/changed", { at: started });
  await vi.waitFor(() => expect(line()).not.toContain("Stopped"));
  expect(asked()).toBe(1);
  // Stopped again: the kernel has recorded a second "stopped". The events held are from before it.
  agents = digest({ startedAt: started });
  events = [{ ...stop, at: first }, { ...stop, at: second }];
  await slot.behavior.emitRealtime("oats/changed", { at: second });
  await vi.waitFor(() => expect(line()).toBe(`Stopped· since ${waitingClock(second)}StartInstance panel`));
  expect(asked()).toBe(2);
});

test("events read before the session's start hold no time for this stop: the line says none, never an earlier stop's", async () => {
  const agents = fixtureAgents().map((agent) => (agent.instance === "weekly-digest-helper" ? { ...agent, startedAt: "2026-11-22T08:00:00.000Z" } : agent));
  const slot = await render("thr_digest", agents); // the recorded events: stopped at 2026-11-21T18:23:24.196Z, before that start
  await vi.waitFor(() => expect(slot.inspection.rpcCalls.some((call) => call.method === "panelEvents")).toBe(true));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(slot.getByTestId("oats-status-line").textContent).toBe("StoppedStartInstance panel");
});

// The settings can mend what Retry cannot (which machine holds the agents): the notice then has no
// Retry, and its sentence names what it does have.
test("on the last roster read with no Retry to offer, the one-line notice names the settings and links to them", async () => {
  const last = { at: new Date(Date.now() - 2 * 60_000).toISOString(), deployment: { root: "/abs/deployment", workspace: "oats", machine: "falcon" }, agents: fixtureAgents() };
  const slot = await render("thr_mockups", fixtureAgents(), { snapshot: () => ({ ok: false, at: new Date().toISOString(), code: "CHOOSE_HOST", message: "This bb server has 2 machines", last }) });
  const stale = await slot.findByTestId("oats-unreadable");
  expect(stale.textContent).toBe("Choose the machine that holds your agentsShowing what was read 2 min ago. Open settings: Stop, Start, Restart, Retire and New agent return when OATS is read again.Open settings");
  expect(within(stale).queryByRole("button", { name: "Retry" })).toBeNull();
  expect(within(stale).getByRole("link", { name: "Open settings" }).getAttribute("href")).toBe("/settings/plugins/test-plugin");
});

// B3: an agent that runs is stopped from its own thread, through OATS: the plan is read first, and
// nothing stops on one press.
test("Stop on a working agent's line asks OATS for the stop plan of that agent, and stops nothing by itself", async () => {
  const app = await loadApp();
  const { ActsOverlay } = await import("../../app/lifecycle/acts");
  const Row = app.threadHeaderRows[0]!.component;
  const slot = renderSlot<ExperimentalThreadHeaderRowProps, Contract>(
    { component: (props: ExperimentalThreadHeaderRowProps) => (<><Row {...props} /><ActsOverlay /></>) } as never,
    { threadId: "thr_mockups", projectId: "p", environment: null },
    { rpc: handlers(), sidebarThreads: sidebarThreads() },
  );
  fireEvent.click(await slot.findByTestId("oats-status-act"));
  await vi.waitFor(() => expect(slot.inspection.rpcCalls.filter((call) => call.method === "stopPlan").map((call) => call.input)).toEqual([{ instance: "desktop-mockups-developer" }]));
  expect(slot.inspection.rpcCalls.some((call) => call.method === "stopApply")).toBe(false);
});
