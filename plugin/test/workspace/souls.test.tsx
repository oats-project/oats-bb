// @vitest-environment jsdom
// A11: the Souls page (navPanel `souls`): a soul with its agents, the way to the New agent form, and a soul that cannot be spawned.
import { afterEach, expect, test } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { setAgentPage } from "../../app/home/agent-tab";
import { fixtureAgents, fixtureThreads } from "../helpers/fixtures";
import { handlers, loadApp, resetApp, sidebarThreads } from "../helpers/render";
import type { Contract, Handlers } from "../helpers/render";
import type { Agent } from "../../model/types";

afterEach(() => {
  agentPage = null;
  resetApp();
});

// The page of one agent, as these tests name it: none, unless a test gives one. Named after the
// app is loaded, since a feature that has such a page names its own in its `register`.
let agentPage: Parameters<typeof setAgentPage>[0] = null;

async function souls(subPath: string, over: Partial<Handlers> = {}, agents?: Agent[], threads = fixtureThreads()) {
  const app = await loadApp();
  setAgentPage(agentPage);
  const panel = app.navPanels.find((candidate) => candidate.id === "souls")!;
  expect(panel.experimental_hideFromNavigation).toBe(true);
  return renderSlot<{ subPath: string }, Contract>(panel, { subPath }, { rpc: handlers(over, agents), sidebarThreads: { status: "ready", threads } });
}

const rpcOf = (slot: Awaited<ReturnType<typeof souls>>, method: string) => slot.inspection.rpcCalls.filter((call) => call.method === method);

test("the list: each soul with the number of this deployment's agents; a click opens the soul", async () => {
  const slot = await souls("");
  const rows = await slot.findAllByTestId("oats-soul-row");
  await waitFor(() => expect(rows.map((row) => row.textContent)).toEqual(["oats-developer2 agents", "broken-soul0 agents"]));
  expect(slot.queryByTestId("oats-soul-detail")).toBeNull();
  fireEvent.click(rows[0]!);
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "souls", options: { subPath: "oats-developer" } }]);
});

test("the picked soul: description, origin, capabilities, and its agents by where they are", async () => {
  const slot = await souls("oats-developer");
  const detail = await slot.findByTestId("oats-soul-detail");
  expect(detail.textContent).toContain("Builds and proves one spec.");
  expect(detail.textContent).toContain("from oats.framework 1.12.0");
  for (const id of ["oats.core", "oats.aweb", "oats.developer"]) expect(detail.textContent).toContain(id);
  // in the tree: a link to its thread
  const inTree = await slot.findByTestId("oats-soul-agent");
  expect(inTree.getAttribute("href")).toBe("/projects/proj_ci/threads/thr_ci");
  fireEvent.click(inTree);
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "thr_ci" }]);
  // on tmux: labelled with the backend
  expect(slot.getByTestId("oats-soul-agent-elsewhere").textContent).toBe("Kernel fix developeron tmux");
});

test("a soul that can be spawned: New agent opens the form's own page with that soul chosen", async () => {
  const slot = await souls("oats-developer");
  fireEvent.click(await slot.findByTestId("oats-soul-new-agent"));
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "new-agent", options: { subPath: "oats-developer" } }]);
  // The form is not on the soul's page: its tests are test/spawn/page.test.tsx.
  expect(slot.queryByTestId("oats-spawn-form")).toBeNull();
});

test("spawnable: false shows the problem and no form", async () => {
  const slot = await souls("broken-soul");
  expect((await slot.findByTestId("oats-soul-problem")).textContent).toBe(
    "E_SOUL_INVALID: soul.yaml names a capability that is not installed: oats.missing",
  );
  expect(slot.queryByTestId("oats-spawn-form")).toBeNull();
  expect(slot.queryByTestId("oats-spawn-submit")).toBeNull();
  expect(slot.queryByTestId("oats-spawn-mode")).toBeNull();
});

test("an agent whose thread is archived shows as thread missing, with Start and Retire", async () => {
  const threads = fixtureThreads().map((thread) => (thread.id === "thr_ci" ? { ...thread, isArchived: true } : thread));
  const slot = await souls("oats-developer", { start: () => ({ threadId: "thr_restarted" }) }, fixtureAgents(), threads);
  const missing = await slot.findByTestId("oats-soul-agent-detached");
  expect(missing.textContent).toBe("Flaky ci developerthread missingStartRetire");
  expect(slot.queryByTestId("oats-soul-agent")).toBeNull();
  fireEvent.click(slot.getByTestId("oats-detached-start"));
  await waitFor(() => expect(slot.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "thr_restarted" }]));
  expect(rpcOf(slot, "start").map((call) => call.input)).toEqual([{ instance: "flaky-ci-developer" }]);
});

test("a soul name in the URL that the deployment does not have says so", async () => {
  const slot = await souls("no%20such%20soul");
  expect((await slot.findByText("This deployment has no soul named no such soul.")).tagName).toBe("P");
});

test("when souls cannot be read: the kernel's message and Retry", async () => {
  let failing = true;
  const slot = await souls("", {
    souls: () => {
      if (failing) throw new Error("E_OATS_TIMEOUT: oats souls did not answer in 20 s");
      return handlers().souls(null);
    },
  });
  expect((await slot.findByRole("alert")).textContent).toBe("E_OATS_TIMEOUT: oats souls did not answer in 20 sRetry");
  failing = false;
  fireEvent.click(slot.getByRole("button", { name: "Retry" }));
  expect(await slot.findAllByTestId("oats-soul-row")).toHaveLength(2);
});

test("a package soul's agents are matched by its roster agent name, not by its key", async () => {
  // bb hands the key back as it took it: `/`-separated segments, each percent-encoded
  const slot = await souls("oats.okf/knowledge-harvester", {
    souls: () => ({
      souls: [{ name: "oats.okf/knowledge-harvester", agent: "knowledge-harvester", description: "Harvests.", origin: "oats.okf 2.1.0", capabilities: [], spawnable: true, problem: null }],
    }),
  });
  expect((await slot.findByTestId("oats-soul-agent")).getAttribute("href")).toBe("/projects/proj_harvest/threads/thr_harvest");
  expect(slot.getByTestId("oats-soul-row").textContent).toBe("oats.okf/knowledge-harvester1 agent");
  expect(slot.getByTestId("oats-soul-new-agent")).toBeTruthy();
  // and the row opens it with the key as bb's unencoded segments
  fireEvent.click(slot.getByTestId("oats-soul-row"));
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "souls", options: { subPath: "oats.okf/knowledge-harvester" } }]);
});

test("a soul key with characters bb percent-encodes is decoded segment by segment", async () => {
  const slot = await souls("my%20pkg/soul%2Fx", {
    souls: () => ({ souls: [{ name: "my pkg/soul/x", agent: "x", description: "", origin: "o", capabilities: [], spawnable: true, problem: null }] }),
  });
  expect((await slot.findByTestId("oats-soul-detail")).textContent).toContain("my pkg/soul/x");
});

test("while bb is still listing its threads a soul's agents are not shown as missing", async () => {
  const app = await loadApp();
  setAgentPage(agentPage);
  const panel = app.navPanels.find((candidate) => candidate.id === "souls")!;
  const slot = renderSlot<{ subPath: string }, Contract>(panel, { subPath: "oats-developer" }, { rpc: handlers(), sidebarThreads: { status: "loading", threads: [] } });
  await slot.findByTestId("oats-soul-detail");
  await waitFor(() => expect(slot.inspection.rpcCalls.map((call) => call.method)).toContain("snapshot"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(slot.queryByTestId("oats-soul-agent-detached")).toBeNull();
  expect(slot.queryByText("thread missing")).toBeNull();
});

test("an agent with no bb thread opens its own page, where a feature gives agents one", async () => {
  const opened: string[] = [];
  const plain = await souls("oats-developer");
  await plain.findByTestId("oats-soul-agent-elsewhere");
  expect(plain.queryByTestId("oats-soul-agent-open")).toBeNull(); // no feature has a page: nothing to press
  plain.unmount();
  agentPage = (_navigate, instance) => void opened.push(instance);
  const slot = await souls("oats-developer");
  fireEvent.click(await slot.findByTestId("oats-soul-agent-open"));
  expect(opened).toEqual(["kernel-fix-developer"]);
});

// A soul's agents are the roster's: while OATS cannot be read the page says so with the notice
// every place shows, above the agents as last read; with no roster ever read, the notice alone.
test("a soul's page while OATS cannot be read: the notice with the age above its agents as last read; with no roster, the notice and no raw line", async () => {
  const last = { at: new Date(Date.now() - 40 * 60_000).toISOString(), deployment: { root: "/abs/deployment", workspace: "oats", machine: "falcon" }, agents: fixtureAgents() };
  const failed = (kept: typeof last | null) => () => ({ ok: false as const, at: new Date().toISOString(), code: "OATS_NOT_FOUND", message: "oats was not found on falcon: install OATS there", machine: "falcon", last: kept });
  const stale = await souls("oats-developer", { snapshot: failed(last) });
  const notice = await stale.findByRole("alert");
  expect(notice.querySelector("h3")!.textContent).toBe("OATS is not installed on falcon");
  expect(notice.textContent).toContain("Showing what was read 40 min ago.");
  expect(stale.getByTestId("oats-soul-detail").textContent).toContain("Flaky ci developer");
  stale.unmount();
  resetApp();
  const never = await souls("oats-developer", { snapshot: failed(null) });
  const alone = await never.findByRole("alert");
  expect(alone.querySelector("h3")!.textContent).toBe("OATS is not installed on falcon");
  expect(never.getByTestId("oats-soul-detail").textContent).not.toContain("Flaky ci developer");
  expect(never.getByRole("button", { name: "Retry" })).toBeTruthy();
});

test("the Souls list while OATS cannot be read: the page's one notice, with the age above the counts as last read; with no roster, the notice and no count", async () => {
  const last = { at: new Date(Date.now() - 40 * 60_000).toISOString(), deployment: { root: "/abs/deployment", workspace: "oats", machine: "falcon" }, agents: fixtureAgents() };
  const failed = (kept: typeof last | null) => () => ({ ok: false as const, at: new Date().toISOString(), code: "OATS_NOT_FOUND", message: "oats was not found on falcon: install OATS there", machine: "falcon", last: kept });
  const stale = await souls("", { snapshot: failed(last) });
  const notice = await stale.findByRole("alert");
  expect(notice.textContent).toContain("Showing what was read 40 min ago.");
  expect(stale.getAllByTestId("oats-unreadable")).toHaveLength(1);
  await waitFor(() => expect(stale.getByTestId("oats-souls-page").textContent).toMatch(/oats-developer\s*2 agents/));
  stale.unmount();
  resetApp();
  const never = await souls("", { snapshot: failed(null) });
  expect((await never.findByRole("alert")).querySelector("h3")!.textContent).toBe("OATS is not installed on falcon");
  expect(never.getByTestId("oats-souls-page").textContent).not.toMatch(/\d+ agents?/);
  // And with a soul picked there is still one notice for the page, not two.
  never.unmount();
  resetApp();
  const picked = await souls("oats-developer", { snapshot: failed(last) });
  await picked.findByRole("alert");
  expect(picked.getAllByTestId("oats-unreadable")).toHaveLength(1);
});
