// @vitest-environment jsdom
// Every text from OATS or an agent that a slot draws goes through the display filter
// (app/ui/text.ts): each kind of free text is given a hostile value here, in the server's or bb's
// answer, and the slot must draw one line, U+FFFD for a character that is no text, and "[withheld]"
// for what looks like a secret. The kinds held: the sidebar's workspace line and rows, the thread's
// row, the home's cards and reply box, a soul's page, the capabilities and the machines, the spawn
// preview (and, in test/lifecycle/actions.test.tsx, a plan's lines).
import { afterEach, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { ExperimentalThreadHeaderRowProps, PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { fixtureAgents, fixtureSnapshot } from "../helpers/fixtures";
import { handlers, loadApp, resetApp, sidebarThreads, SOULS } from "../helpers/render";
import type { Contract, Handlers } from "../helpers/render";

afterEach(resetApp);

const BIDI = "\u202E";
const GONE = "\uFFFD";
const NO_INTERACTIONS = { threads: { interactions: { list: async () => [] as never } } };

async function page(id: string, subPath: string, rpc: Handlers) {
  const app = await loadApp();
  const panel = app.navPanels.find((candidate) => candidate.id === id)!;
  return renderSlot<{ subPath: string }, Contract>(panel, { subPath }, { rpc, sidebarThreads: sidebarThreads(), sdk: NO_INTERACTIONS });
}

test("the home's card: an agent's message with a line break and a bidi override is one line; one that looks like a secret is withheld whole", async () => {
  const agents = fixtureAgents().map((agent) =>
    agent.instance === "release-070-maintainer"
      ? { ...agent, waiting: { ...agent.waiting!, message: `Ship${BIDI} it?\n\tSecond line` } }
      : agent.instance === "ranker-v3-probe"
        ? { ...agent, waiting: { ...agent.waiting!, message: "Use token=abc123 for the registry?" } }
        : agent,
  );
  const slot = await page("home", "", handlers({}, agents));
  await slot.findAllByTestId("oats-needs-card");
  const questions = slot.getAllByTestId("oats-needs-question").map((question) => question.textContent);
  expect(questions).toContain(`Ship${GONE} it? Second line`);
  expect(questions).toContain("[withheld]");
  expect(questions.join("")).not.toMatch(/[\n\t\u202E]|abc123/);
});

test("the sidebar: the workspace's name and a soul's name are each one filtered line; the machine is not drawn", async () => {
  const agents = fixtureAgents().map((agent) => (agent.instance === "flaky-ci-developer" ? { ...agent, soul: `oats${BIDI}developer` } : agent));
  const snapshot = { ...fixtureSnapshot(agents), deployment: { root: "/abs/deployment", workspace: `oats${BIDI}`, machine: "che\ncks" } };
  const app = await loadApp();
  const slot = renderSlot<PluginThreadListProps, Contract>(
    app.threadLists[0]!,
    { activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate: () => undefined, searchQuery: "" },
    { rpc: handlers({ snapshot: () => snapshot, souls: () => ({ souls: [] }) }), sidebarThreads: sidebarThreads() },
  );
  expect((await slot.findByTestId("oats-workspace-line")).textContent).toBe(`oats${GONE}`);
  // The soul is on the row, through the display filter; the machine is not on the line.
  const row = slot.getAllByTestId("oats-agent-row").find((candidate) => candidate.getAttribute("data-sidebar-thread-id") === "thr_ci")!;
  expect(within(row).getByTestId("oats-row-facts").textContent).toBe(`Needs you · oats${GONE}developer`);
  expect(slot.getByTestId("oats-sidebar").textContent).not.toMatch(/che cks|checks/);
  expect(slot.getByTestId("oats-sidebar").textContent).not.toMatch(/[\n\u202E]/);
});

test("the home: what bb says an agent asks (its title, its choices) and an agent's name in its reply are filtered", async () => {
  const renamed = fixtureAgents().map((agent) => (agent.instance === "flaky-ci-developer" ? { ...agent, instance: `flaky${BIDI}ci-developer` } : agent));
  const asked = [{ id: "p1", threadId: "thr_x", status: "pending", payload: { kind: "provider-pi/extension-ui", title: "Confirm", data: { method: "select", fullTitle: "Run\tit\nnow?", options: [`Yes${BIDI}`, "use password: hunter2"] } } }];
  const app = await loadApp();
  const panel = app.navPanels.find((candidate) => candidate.id === "home")!;
  const slot = renderSlot<{ subPath: string }, Contract>(panel, { subPath: "" }, { rpc: handlers({}, renamed), sidebarThreads: sidebarThreads(), sdk: { threads: { interactions: { list: async () => asked as never } } } });
  await waitFor(() => expect(slot.getAllByTestId("oats-needs-choice").map((choice) => choice.textContent)).toEqual(expect.arrayContaining([`Yes${GONE}`, "[withheld]"])));
  expect(slot.getAllByTestId("oats-needs-detail").map((detail) => detail.textContent)).toContain("Run it now?");
  // the reply is on the agent's card and names the agent: its name goes through the filter as every OATS text
  expect(slot.getAllByTestId("oats-reply-text").map((box) => (box as HTMLTextAreaElement).placeholder)).toContain(`Write to Flaky${GONE}ci developer…`);
});

test("the machines page: a server's id, its route and its folder are each one filtered line", async () => {
  const machines = [
    { id: "checks", route: null, isThisMachine: true, label: null, folder: null },
    { id: `dev${BIDI}box`, route: "ssh://joan:pw@devbox.invalid", isThisMachine: false, label: null, folder: "/srv/oats\nmore" },
  ];
  const slot = await page("machines", "", handlers({ machines: () => ({ machines }) }));
  const row = (await slot.findAllByTestId("oats-machine-row"))[1]!;
  expect(row.firstElementChild!.firstElementChild!.textContent).toBe(`dev${GONE}box`);
  // Under its Details: the ssh host (a credential in it is withheld whole) and the folder, each one filtered line.
  expect(Array.from(row.querySelectorAll("details p")).map((part) => part.textContent)).toEqual(["ssh host: [withheld]", "Folder: /srv/oats more"]);
});

test("the thread's row: an agent's question with a character that is no text is drawn with U+FFFD; its soul and its alias are not drawn there", async () => {
  const agents = fixtureAgents().map((agent) => (agent.instance === "flaky-ci-developer" ? { ...agent, soul: `oats${BIDI}developer`, alias: `flaky\u200Bci`, address: null, waiting: { reason: "question", message: `Which${BIDI} branch?\nmain`, since: null } } : agent));
  const app = await loadApp();
  const row = renderSlot<ExperimentalThreadHeaderRowProps, Contract>(app.threadHeaderRows[0]!, { threadId: "thr_ci", projectId: "proj_ci", environment: null }, { rpc: handlers({ souls: () => ({ souls: [] }) }, agents), sidebarThreads: sidebarThreads() });
  expect((await row.findByTestId("oats-status-line")).textContent).toBe(`!Needs you· Which${GONE} branch? mainAnswerInstance panel`);
  // Who it is (its soul, its messaging ID) is the instance panel's: no such fact is on the row.
  expect(row.queryByTestId("oats-fact-soul")).toBeNull();
  expect(row.queryByTestId("oats-fact-identity")).toBeNull();
  expect(row.getByTestId("oats-identity-row").textContent).not.toMatch(/developer.*oats|flaky.ci\b/);
});

test("a soul's page: its description and its problem, and a capability's description, are one filtered line each", async () => {
  const souls = [
    { ...SOULS[0]!, description: `Builds${BIDI} one spec.\nAnd proves it.`, origin: "from\tthe workspace" },
    { ...SOULS[1]!, problem: "E_SOUL_INVALID: the soul's file holds password: hunter2" },
  ];
  const soul = await page("souls", "oats-developer", handlers({ souls: () => ({ souls }) }));
  const detail = await soul.findByTestId("oats-soul-detail");
  expect(detail.querySelector("header p")!.textContent).toBe(`Builds${GONE} one spec. And proves it.`);
  expect(detail.textContent).toContain("from from the workspace");
  expect(detail.textContent).not.toMatch(/[\n\t\u202E]/);
  soul.unmount();
  // A refusal keeps its code; what is unsafe in its message is withheld whole.
  const broken = await page("souls", "broken-soul", handlers({ souls: () => ({ souls }) }));
  await broken.findByTestId("oats-soul-detail");
  // (The kernel's words on why it cannot be spawned are under the page's Details.)
  expect(Array.from(broken.getByTestId("oats-soul-details").querySelectorAll("p")).map((line) => line.textContent)).toContain("E_SOUL_INVALID: [withheld]");
  broken.unmount();
  const capabilities = await page(
    "capabilities",
    "",
    handlers({ capabilities: () => ({ capabilities: [{ id: `oats${BIDI}core`, description: "Day-to-day\noperation. api_key = sk-123", origin: "x", souls: 1 }] }) }),
  );
  const capability = await capabilities.findByTestId("oats-capability-row");
  expect(capability.querySelector("span")!.textContent).toBe(`oats${GONE}core`);
  expect(capability.querySelector('[data-testid="oats-capability-does"]')!.textContent).toBe("[withheld]");
});
