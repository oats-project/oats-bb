// @vitest-environment jsdom
// A9: the IdentityRow (experimental_threadHeaderRow).
import { afterEach, expect, test, vi } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import type { ExperimentalThreadHeaderRowProps } from "@get-bb/plugin-sdk/app";
import { setAgentPage } from "../../app/home/agent-tab";
import { fixtureAgents } from "../helpers/fixtures";
import { handlers, loadApp, resetApp, sidebarThreads } from "../helpers/render";
import { asked } from "../../app/lifecycle";
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

/** The facts that left the thread's row for the instance panel (its header, Lineage and Messaging ID: test/panel/panel.test.tsx): none is drawn on the row. */
const FACTS = ["oats-identity-facts", "oats-fact-soul", "oats-fact-parent", "oats-fact-children", "oats-fact-identity"];
const noFacts = (slot: Awaited<ReturnType<typeof row>>) => {
  for (const id of FACTS) expect(slot.queryByTestId(id)).toBeNull();
  expect(slot.getByTestId("oats-identity-row").querySelector("a")).toBeNull();
};
const render = async (threadId: string, agents: ReturnType<typeof fixtureAgents>, over: Parameters<typeof handlers>[0] = {}) => {
  const app = await loadApp();
  setAgentPage(agentPage);
  return renderSlot<ExperimentalThreadHeaderRowProps, Contract>(app.threadHeaderRows[0]!, { threadId, projectId: "p", environment: null }, { rpc: handlers(over, agents), sidebarThreads: sidebarThreads() });
};

// WHOSE line it is (the lead's ruling S1 on its reader's report, 24 Nov 2026). bb's title over the row is the agent's
// name at every start; a person can rename the thread or have bb write a title again, and bb's own title of a thread
// that had none is its first message. The acts on the line must never sit under a name that is not the agent's.
test("the thread's line starts with the agent's NAME whenever bb's title is not exactly that name, and never when it is: no name twice", async () => {
  const nameOn = async (title: string) => {
    const slot = await row("thr_mockups", { sidebarThreads: titled({ thr_mockups: title }) });
    const block = await slot.findByTestId("oats-identity-row");
    const name = slot.queryByTestId("oats-thread-agent");
    const read = { name: name?.textContent ?? null, first: name !== null && block.firstElementChild === name, line: slot.getByTestId("oats-status-line").textContent };
    resetApp();
    return read;
  };
  // As the provider titled it: the name is over the row already, and the line does not say it again.
  expect(await nameOn("Desktop mockups developer")).toEqual({ name: null, first: false, line: "WorkingStop…Instance panel" });
  // A person RENAMED the thread: the line says whose it is, first, and its acts are the same.
  expect(await nameOn("Try the new sidebar")).toEqual({ name: "Desktop mockups developer", first: true, line: "WorkingStop…Instance panel" });
  // bb wrote the title from the first message, or again (Regenerate title); a title that only looks like the name is not it.
  expect((await nameOn("hello")).name).toBe("Desktop mockups developer");
  expect((await nameOn("Desktop mockups")).name).toBe("Desktop mockups developer");
  expect((await nameOn("desktop-mockups-developer")).name).toBe("Desktop mockups developer");
  expect((await nameOn("Desktop mockups developer ")).name).toBe("Desktop mockups developer");
});

/** bb's threads with some of them titled as given (by thread id): a title is what bb's header over the row says. */
const titled = (titles: Record<string, string>) => ({ status: "ready" as const, threads: sidebarThreads().threads.map((thread) => (thread.id in titles ? { ...thread, title: titles[thread.id]!, displayTitle: titles[thread.id]! } : thread)) });

test("the status line is the whole row and says where the agent is in words: a working child, with the way to its instance panel and no facts", async () => {
  // bb's title of the thread is the agent's name as words, as the provider gives it at every start: the row is the line alone.
  const slot = await row("thr_mockups", { experimental_panel: { openTab: () => true }, sidebarThreads: titled({ thr_mockups: "Desktop mockups developer" }) });
  const block = await slot.findByTestId("oats-identity-row");
  expect(block.firstElementChild).toBe(slot.getByTestId("oats-status-line"));
  expect(block.children).toHaveLength(1);
  expect(block.textContent).toBe("WorkingStop…Instance panel"); // the state, then the one row of buttons: the act that applies, and the panel
  const stop = slot.getByTestId("oats-status-act") as HTMLButtonElement;
  expect([stop.textContent, stop.disabled, stop.title]).toEqual(["Stop…", false, "Stop this agent through OATS"]);
  // Its soul, its parent and its messaging ID are not on the row, as words or as links: the
  // instance panel holds them, one press away.
  noFacts(slot);
  expect(block.textContent).not.toMatch(/instance of|oats-desktop-developer|Parent|Redesign ui lead|Messaging ID/);
  expect(slot.inspection.navigateCalls).toEqual([]);
  // "Instance panel" opens the thread's fixed tab.
  fireEvent.click(slot.getByTestId("oats-open-panel"));
  expect(slot.inspection.experimental_panelCalls).toEqual([{ method: "openTab", options: { tab: { id: "home", context: { kind: "thread" }, availability: "fixed" } } }]);
});

test("an agent that needs you: how long it has waited and its question, on its own thread; no clock time", async () => {
  const since = new Date(Date.now() - 12 * 60_000 - 5_000).toISOString();
  const agents = fixtureAgents().map((agent) => (agent.instance === "release-070-maintainer" ? { ...agent, waiting: { reason: "question", message: "Green light at 9f2e1c?", since } } : agent));
  const slot = await render("thr_release", agents);
  const line = await slot.findByTestId("oats-status-line");
  expect(line.getAttribute("data-state")).toBe("needs-you");
  // How long, in two words; when it began (a clock time) is not on the line.
  expect(line.textContent).toBe("!Needs you· 12 min· Green light at 9f2e1c?AnswerInstance panel");
  // "Answer" is the way to reply (what is asked is on the line): it opens the instance panel, and
  // where the panel is drawn it moves the focus to "Needs input".
  const needs = document.createElement("section");
  needs.setAttribute("data-testid", "oats-panel-waiting");
  needs.append(document.createElement("textarea"));
  document.body.append(needs);
  try {
    fireEvent.click(slot.getByTestId("oats-status-act"));
    expect(slot.inspection.experimental_panelCalls.map((call) => call.method)).toEqual(["openTab"]);
    expect(document.activeElement).toBe(needs.querySelector("textarea"));
  } finally {
    needs.remove();
  }
});

test("a stopped agent says Stopped and offers Start, which opens the Start dialog and starts nothing by itself; one whose session ended offers Start too (nothing runs); one the kernel cannot reach says Unreachable, with what OATS says under Details, and Retry", async () => {
  const stopped = await render("thr_digest", fixtureAgents());
  // The warning of a stopped agent's live composer, in the warning tone, with Start beside it.
  expect((await stopped.findByTestId("oats-status-line")).textContent).toBe("Stopped· A message here starts it outside OATS.Start…Instance panel");
  expect(stopped.getByTestId("oats-status-part").getAttribute("data-tone")).toBe("warning");
  fireEvent.click(stopped.getByTestId("oats-status-act"));
  // The act's own dialog is asked for (test/lifecycle/actions.test.tsx holds what it does): nothing runs on one press.
  expect(asked()).toEqual({ verb: "start", instance: "weekly-digest-helper" });
  expect(stopped.inspection.rpcCalls.filter((call) => call.method === "start")).toEqual([]);
  stopped.unmount();
  const states = fixtureAgents().map((agent) =>
    agent.instance === "harvest-knowledge-helper"
      ? { ...agent, running: false, runtimeState: "shell" }
      : agent.instance === "desktop-mockups-developer"
        ? { ...agent, running: null, runtimeState: "unreachable", runtimeError: "bb did not answer" }
        : agent,
  );
  const failed = await render("thr_harvest", states);
  expect((await failed.findByTestId("oats-status-line")).textContent).toBe("Failed· session endedStart…Instance panel"); // the reason after the state; Start is the button beside it (the kernel's row says it does not run: the lifecycle's one act for it)
  failed.unmount();
  const unreachable = await render("thr_mockups", states);
  // The state's word says it, with no sentence that repeats it; what the kernel said is one press away, under Details, never the line's words.
  expect((await unreachable.findByTestId("oats-status-line")).textContent).toBe("UnreachableRetryInstance panel");
  expect(unreachable.getByTestId("oats-identity-row").textContent).not.toContain("OATS cannot reach its session");
  const kernel = unreachable.getByTestId("oats-status-kernel") as HTMLDetailsElement;
  expect(kernel.open).toBe(false);
  expect(kernel.querySelector("p")!.textContent).toBe("OATS says: bb did not answer");
});

// Who started an agent, its children, its messaging ID and its parent were facts of this row: they
// are the instance panel's now (Lineage, Messaging ID: test/panel/panel.test.tsx holds what each
// says, and which is a link). The row draws none of them, for any shape of agent.
test("a root agent with children: the row says neither who started it nor how many children it has", async () => {
  const slot = await row("thr_redesign");
  const block = await slot.findByTestId("oats-identity-row");
  noFacts(slot);
  expect(block.textContent).not.toMatch(/Owning human|joan|Children/);
});

test("an agent with an address, and one with no messaging identity: the row says no messaging ID of either", async () => {
  const agents = fixtureAgents().map((agent) =>
    agent.instance === "redesign-ui-lead"
      ? { ...agent, address: "oats.aweb.ai/redesign-ui-lead" }
      : agent.instance === "flaky-ci-developer"
        ? { ...agent, alias: null, team: null, address: null }
        : agent,
  );
  const withAddress = await render("thr_redesign", agents);
  await withAddress.findByTestId("oats-identity-row");
  noFacts(withAddress);
  expect(withAddress.getByTestId("oats-identity-row").textContent).not.toMatch(/Messaging ID|oats\.aweb\.ai/);
  withAddress.unmount();
  const without = await render("thr_ci", agents);
  await without.findByTestId("oats-identity-row");
  noFacts(without);
});

test("a parent that is not in bb is not named on the row either", async () => {
  const agents = fixtureAgents().map((agent) => (agent.instance === "ranker-v3-probe" ? { ...agent, parent: "kernel-fix-developer" } : agent));
  const slot = await render("thr_research", agents);
  const block = await slot.findByTestId("oats-identity-row");
  noFacts(slot);
  expect(block.textContent).not.toMatch(/Parent|Kernel fix developer/);
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
  for (const part of [block, slot.getByTestId("oats-status-line")]) {
    expect(part.className).not.toMatch(/overflow-x-auto|whitespace-nowrap|truncate/);
  }
  // The status line wraps inside its frame (the frame clips only the strip a separator at a line's start falls in).
  expect(slot.getByTestId("oats-status-line").firstElementChild!.className).toContain("flex-wrap");
});

test("on the last roster read, while OATS cannot be read: the line as last read, its act off, and under it the one drawing of why: the age, that the acts are off, Retry", async () => {
  const last = { at: new Date(Date.now() - 2 * 60_000 - 5_000).toISOString(), deployment: { root: "/abs/deployment", workspace: "oats", machine: "falcon" }, agents: fixtureAgents() };
  const slot = await render("thr_mockups", fixtureAgents(), { snapshot: () => ({ ok: false, at: new Date().toISOString(), code: "OATS_TIMEOUT", message: "oats did not answer", last }) });
  expect((await slot.findByTestId("oats-status-line")).textContent).toBe("WorkingStop…Instance panel");
  // SAFETY: the act that applies is held: in its place, off, and a press does nothing. No reason of its
  // own, in words or in a title: the one-line notice under it, in the same row, says why, with Retry.
  const held = slot.getByTestId("oats-status-act") as HTMLButtonElement;
  expect([held.textContent, held.disabled, held.title]).toEqual(["Stop…", true, ""]);
  fireEvent.click(held);
  expect(asked()).toBeNull();
  expect(slot.getByTestId("oats-identity-row").textContent).not.toContain("Comes back when OATS is read again");
  const stale = slot.getByTestId("oats-unreadable");
  expect(slot.getByTestId("oats-identity-row").contains(stale)).toBe(true);
  expect(stale.getAttribute("data-compact")).toBe("");
  expect(stale.textContent).toBe("OATS did not answer on falconRead 2 min ago. Acts are off.Retry");
  fireEvent.click(within(stale).getByRole("button", { name: "Retry" }));
  await vi.waitFor(() => expect(slot.inspection.rpcCalls.some((call) => call.method === "refresh")).toBe(true));
  slot.unmount();
  // A stopped agent's Start stays in its place, off, under the same one-line notice.
  const stopped = await render("thr_digest", fixtureAgents(), { snapshot: () => ({ ok: false, at: new Date().toISOString(), code: "OATS_TIMEOUT", message: "oats did not answer", last }) });
  const start = (await stopped.findByTestId("oats-status-act")) as HTMLButtonElement;
  expect([start.textContent, start.disabled, start.title]).toEqual(["Start…", true, ""]);
  expect(stopped.getByTestId("oats-unreadable").textContent).toBe("OATS did not answer on falconRead 2 min ago. Acts are off.Retry");
  fireEvent.click(start);
  expect(asked()).toBeNull();
});

test("with no roster ever read the row says that OATS cannot be read, with Retry: never nothing", async () => {
  const slot = await render("thr_mockups", fixtureAgents(), { snapshot: () => ({ ok: false, at: "t", code: "OATS_NOT_FOUND", message: "oats: not found", last: null }) });
  const block = await slot.findByTestId("oats-identity-row");
  expect(block.textContent).toBe("OATS is not installed on this machineRetry");
  fireEvent.click(slot.getByRole("button", { name: "Retry" }));
  await vi.waitFor(() => expect(slot.inspection.rpcCalls.some((call) => call.method === "refresh")).toBe(true));
});

// The soul was a fact of this row, a link where the Souls page is shown: it is the instance
// panel's header's now. Whatever pages the release shows, the row names no soul and links nowhere.
test("the soul is not on the row, whether the Souls page is shown or not", async () => {
  const shownSlot = await row("thr_mockups", { settings: { pages: "home, souls" } });
  await shownSlot.findByTestId("oats-identity-row");
  noFacts(shownSlot);
  shownSlot.unmount();
  resetApp();
  const hidden = await row("thr_mockups", { settings: { pages: "home" } });
  await hidden.findByTestId("oats-identity-row");
  noFacts(hidden);
  expect(hidden.getByTestId("oats-identity-row").textContent).not.toMatch(/instance of|oats-desktop-developer/);
});

// When an agent stopped was a time on this line, read from the instance's events. It is a fact of
// the instance panel's Session now (test/panel/panel.test.tsx): the line says the state and its
// warning, and the thread's row asks the kernel for no events, of a stopped agent or of any other.
test("a stopped agent's line says no time, and the thread's row reads no events: of a stopped agent or of one that works", async () => {
  const slot = await render("thr_digest", fixtureAgents()); // the recorded events hold a stop at 2026-11-23T18:01:33.424Z
  await slot.findByTestId("oats-status-line");
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(slot.getByTestId("oats-status-line").textContent).toBe("Stopped· A message here starts it outside OATS.Start…Instance panel");
  expect(slot.getByTestId("oats-identity-row").textContent).not.toMatch(/since|\d\d:\d\d/);
  expect(slot.inspection.rpcCalls.some((call) => call.method === "panelEvents")).toBe(false);
  slot.unmount();
  resetApp();
  const working = await render("thr_mockups", fixtureAgents());
  await working.findByTestId("oats-status-line");
  expect(working.inspection.rpcCalls.some((call) => call.method === "panelEvents")).toBe(false);
});

// An agent stopped, started and stopped again in one window: the line follows the roster at each
// turn, with the same words for both stops and no time of either, and still reads no events.
test("a stopped agent that was started and stopped again: the line says Stopped and its warning both times, with no time, and no events are read", async () => {
  const [started, second] = ["2026-11-21T12:00:00.000Z", "2026-11-21T16:00:00.000Z"];
  const digest = (over: Partial<ReturnType<typeof fixtureAgents>[number]>) => fixtureAgents().map((agent) => (agent.instance === "weekly-digest-helper" ? { ...agent, ...over } : agent));
  let agents = digest({ startedAt: "2026-11-21T09:00:00.000Z" });
  const slot = await render("thr_digest", fixtureAgents(), { snapshot: (input) => handlers({}, agents).snapshot(input) });
  const line = () => slot.getByTestId("oats-status-line").textContent;
  const STOPPED = "Stopped· A message here starts it outside OATS.Start…Instance panel";
  await vi.waitFor(() => expect(line()).toBe(STOPPED));
  // Started: the line is no longer the stopped one.
  agents = digest({ running: true, runtimeState: "running", startedAt: started });
  await slot.behavior.emitRealtime("oats/changed", { at: started });
  await vi.waitFor(() => expect(line()).not.toContain("Stopped"));
  // Stopped again.
  agents = digest({ startedAt: started });
  await slot.behavior.emitRealtime("oats/changed", { at: second });
  await vi.waitFor(() => expect(line()).toBe(STOPPED));
  expect(slot.inspection.rpcCalls.some((call) => call.method === "panelEvents")).toBe(false);
});

test("a session started after the last recorded stop: the line says Stopped and its warning, and no earlier stop's time", async () => {
  const agents = fixtureAgents().map((agent) => (agent.instance === "weekly-digest-helper" ? { ...agent, startedAt: "2026-11-24T08:00:00.000Z" } : agent));
  const slot = await render("thr_digest", agents); // the recorded events: stopped at 2026-11-23T18:01:33.424Z, before that start
  await slot.findByTestId("oats-status-line");
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(slot.getByTestId("oats-status-line").textContent).toBe("Stopped· A message here starts it outside OATS.Start…Instance panel");
  expect(slot.inspection.rpcCalls.some((call) => call.method === "panelEvents")).toBe(false);
});

// The settings can mend what Retry cannot (which machine holds the agents): the notice then has no
// Retry, and its one act is the link to them.
test("on the last roster read with no Retry to offer, the one-line notice says the acts are off and links to the settings", async () => {
  const last = { at: new Date(Date.now() - 2 * 60_000).toISOString(), deployment: { root: "/abs/deployment", workspace: "oats", machine: "falcon" }, agents: fixtureAgents() };
  const slot = await render("thr_mockups", fixtureAgents(), { snapshot: () => ({ ok: false, at: new Date().toISOString(), code: "CHOOSE_HOST", message: "This bb server has 2 machines", last }) });
  const stale = await slot.findByTestId("oats-unreadable");
  expect(stale.textContent).toBe("Choose the machine that holds your agentsRead 2 min ago. Acts are off.Open settings");
  expect(within(stale).queryByRole("button", { name: "Retry" })).toBeNull();
  expect(within(stale).getByRole("link", { name: "Open settings" }).getAttribute("href")).toBe("/settings/plugins/test-plugin");
});

// B3: an agent that runs is stopped from its own thread, through OATS: the plan is read first, and
// nothing stops on one press.
test("Stop on a working agent's line asks for the stop dialog of that agent, and stops nothing by itself", async () => {
  const slot = await render("thr_mockups", fixtureAgents());
  fireEvent.click(await slot.findByTestId("oats-status-act"));
  // The act's own dialog is asked for (test/lifecycle holds what it does): nothing runs on one press.
  expect(asked()).toEqual({ verb: "stop", instance: "desktop-mockups-developer" });
  expect(slot.inspection.rpcCalls.some((call) => call.method === "stopApply")).toBe(false);
});

// The line of one thread of the fixtures, with bb's row of it changed.
const withThread = async (threadId: string, change: Partial<ReturnType<typeof sidebarThreads>["threads"][number]>) => {
  const app = await loadApp();
  setAgentPage(agentPage);
  const threads = sidebarThreads();
  return renderSlot<ExperimentalThreadHeaderRowProps, Contract>(
    app.threadHeaderRows[0]!,
    { threadId, projectId: "p", environment: null },
    { rpc: handlers({}, fixtureAgents()), sidebarThreads: { ...threads, threads: threads.threads.map((thread) => (thread.id === threadId ? { ...thread, ...change } : thread)) } },
  );
};

test("Stop on an idle agent's line too: an agent at rest on its thread runs, and is stopped through its dialog", async () => {
  const slot = await withThread("thr_mockups", { status: "idle", queuedWork: "none", hasPendingInteraction: false });
  const line = await slot.findByTestId("oats-status-line");
  expect(line.getAttribute("data-state")).toBe("idle");
  expect(line.textContent).toBe("IdleStop…Instance panel");
  fireEvent.click(slot.getByTestId("oats-status-act"));
  expect(asked()).toEqual({ verb: "stop", instance: "desktop-mockups-developer" });
  expect(slot.inspection.rpcCalls.some((call) => call.method === "stopApply")).toBe(false);
});

test("a question bb itself shows has no act on the line: it is answered in the thread, and Answer would be a dead press", async () => {
  const slot = await withThread("thr_mockups", { hasPendingInteraction: true });
  const line = await slot.findByTestId("oats-status-line");
  expect(line.getAttribute("data-state")).toBe("needs-you");
  // (The question is in the thread under the line: the line says the state alone.)
  expect(line.textContent).toBe("!Needs youInstance panel");
  expect(slot.queryByTestId("oats-status-act")).toBeNull();
});

// The thread's row reads no events: a kernel whose events cannot be read leaves the line as it is,
// with no time and no error of its own.
test("a stopped agent whose events cannot be read says Stopped and its warning, with no error on its line: the row never asks for them", async () => {
  const slot = await render("thr_digest", fixtureAgents(), {
    panelEvents: () => {
      throw new Error("E_EVENTS_UNREADABLE: the instance's events could not be read");
    },
  });
  await slot.findByTestId("oats-status-line");
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(slot.getByTestId("oats-status-line").textContent).toBe("Stopped· A message here starts it outside OATS.Start…Instance panel");
  expect(slot.inspection.rpcCalls.some((call) => call.method === "panelEvents")).toBe(false);
  expect(slot.getByTestId("oats-identity-row").textContent).not.toContain("E_EVENTS_UNREADABLE");
  expect(slot.queryByRole("alert")).toBeNull();
});

// "Needs input" is on the panel's Instance tab, and the panel keeps the tab it was left on: Answer
// turns it there, so the press is never dead (round 1 of part B's review).
test("Answer turns the instance panel to its Instance tab, where Needs input is, when it was left on another, and moves the focus there", async () => {
  const app = await loadApp();
  const { InstancePanel, showPanelTab } = await import("../../app/panel/Panel");
  const Row = app.threadHeaderRows[0]!.component;
  const slot = renderSlot<ExperimentalThreadHeaderRowProps, Contract>(
    { component: (props: ExperimentalThreadHeaderRowProps) => (<><Row {...props} /><InstancePanel threadId={props.threadId} /></>) } as never,
    { threadId: "thr_release", projectId: "p", environment: null },
    { rpc: handlers(), sidebarThreads: sidebarThreads() },
  );
  await slot.findByTestId("oats-panel-waiting"); // the panel is open on its Instance tab
  showPanelTab("soul"); // and is left on the Soul tab
  await vi.waitFor(() => expect(slot.queryByTestId("oats-panel-waiting")).toBeNull());
  fireEvent.click(await slot.findByTestId("oats-status-act"));
  const needs = await slot.findByTestId("oats-panel-waiting");
  await vi.waitFor(() => expect(needs.contains(document.activeElement)).toBe(true));
});
