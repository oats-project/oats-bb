// @vitest-environment jsdom
// A9: the IdentityRow (experimental_threadHeaderRow).
import { afterEach, expect, test, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
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
  expect(slot.getByTestId("oats-status-line").textContent).toBe("Working");
  expect(slot.queryByTestId("oats-status-act")).toBeNull();
  // Each fact has its label; the instance is not repeated (the thread's title is it), and there is no "✓".
  expect(fact(slot, "oats-fact-soul")).toBe("Souloats-desktop-developer");
  expect(fact(slot, "oats-fact-parent")).toBe("Underredesign-ui-lead");
  expect(fact(slot, "oats-fact-identity")).toBe("Identity in default:oats.aweb.aidesktop-mockups-developer");
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
  expect(line.textContent).toMatch(/^!Needs you· waiting 12 min \(since \d\d:\d\d\)· Green light at 9f2e1c\?$/);
});

test("a stopped agent says Stopped and offers Start, through OATS; one whose session ended offers Restart; one the kernel cannot reach says what OATS says, with Retry", async () => {
  const stopped = await render("thr_digest", fixtureAgents(), { start: () => ({ threadId: "thr_started" }) });
  expect((await stopped.findByTestId("oats-status-line")).textContent).toBe("StoppedStart");
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
  expect((await failed.findByTestId("oats-status-line")).textContent).toBe("Failed· Its session endedRestart");
  failed.unmount();
  const unreachable = await render("thr_mockups", states);
  expect((await unreachable.findByTestId("oats-status-line")).textContent).toBe("Unreachable· OATS says: bb did not answerRetry");
});

test("for a root agent with children: who started it, not a link, and the number of children", async () => {
  const slot = await row("thr_redesign");
  const parent = await slot.findByTestId("oats-fact-parent");
  expect(parent.textContent).toBe("Started byjoan");
  expect(parent.querySelector("a")).toBeNull();
  expect(slot.getByTestId("oats-fact-children").textContent).toBe("2 children");
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
  expect((await withAddress.findByTestId("oats-fact-identity")).textContent).toBe("Identity in default:oats.aweb.aioats.aweb.ai/redesign-ui-lead");
  withAddress.unmount();
  const without = await render("thr_ci", agents);
  await without.findByTestId("oats-fact-soul");
  expect(without.queryByTestId("oats-fact-identity")).toBeNull();
});

test("a parent that is not in bb is named, without a link", async () => {
  const agents = fixtureAgents().map((agent) => (agent.instance === "ranker-v3-probe" ? { ...agent, parent: "kernel-fix-developer" } : agent));
  const slot = await render("thr_research", agents);
  const parent = await slot.findByTestId("oats-fact-parent");
  expect(parent.textContent).toBe("Underkernel-fix-developer");
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
  expect(slot.getByTestId("oats-status-line").className).toContain("flex-wrap");
});

test("on the last roster read, while OATS cannot be read, the line says how old what it shows is", async () => {
  const last = { at: new Date(Date.now() - 2 * 60_000 - 5_000).toISOString(), deployment: { root: "/abs/deployment", workspace: "oats", machine: "falcon" }, agents: fixtureAgents() };
  const slot = await render("thr_mockups", fixtureAgents(), { snapshot: () => ({ ok: false, at: new Date().toISOString(), code: "OATS_TIMEOUT", message: "oats did not answer", last }) });
  expect((await slot.findByTestId("oats-status-line")).textContent).toBe("Working· as of 2 min ago");
});

test("with no roster ever read the row says that OATS cannot be read, with Retry: never nothing", async () => {
  const slot = await render("thr_mockups", fixtureAgents(), { snapshot: () => ({ ok: false, at: "t", code: "OATS_NOT_FOUND", message: "oats: not found", last: null }) });
  const block = await slot.findByTestId("oats-identity-row");
  expect(block.textContent).toBe("OATS is not installed on this machineRetry");
  fireEvent.click(slot.getByRole("button", { name: "Retry" }));
  await vi.waitFor(() => expect(slot.inspection.rpcCalls.some((call) => call.method === "refresh")).toBe(true));
});
