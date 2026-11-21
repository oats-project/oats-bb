// @vitest-environment jsdom
// Every text from OATS or an agent that a slot draws goes through the display filter
// (app/ui/text.ts): each kind of text is given a hostile value here, in the server's answer, and
// the slot must draw one line, U+FFFD for a character that is no text, and "[withheld]" for what
// looks like a secret. A slot that draws such a text raw fails here.
import { afterEach, expect, test } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { ExperimentalThreadHeaderRowProps } from "@get-bb/plugin-sdk/app";
import { fixtureAgents } from "../helpers/fixtures";
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

test("the sidebar and the thread's row: a soul's name and an instance with a character that is no text are drawn with U+FFFD", async () => {
  const agents = fixtureAgents().map((agent) => (agent.instance === "flaky-ci-developer" ? { ...agent, soul: `oats${BIDI}developer`, alias: `flaky\u200Bci`, address: null } : agent));
  const app = await loadApp();
  const row = renderSlot<ExperimentalThreadHeaderRowProps, Contract>(app.threadHeaderRows[0]!, { threadId: "thr_ci", projectId: "proj_ci", environment: null }, { rpc: handlers({ souls: () => ({ souls: [] }) }, agents), sidebarThreads: sidebarThreads() });
  expect((await row.findByTestId("oats-chip-soul")).textContent).toBe(`oats${GONE}developer`);
  expect(row.getByTestId("oats-chip-alias").textContent).toBe(`✓ flaky${GONE}ci`);
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
  expect((await broken.findByTestId("oats-soul-problem")).textContent).toBe("E_SOUL_INVALID: [withheld]");
  broken.unmount();
  const capabilities = await page(
    "capabilities",
    "",
    handlers({ capabilities: () => ({ capabilities: [{ id: `oats${BIDI}core`, description: "Day-to-day\noperation. api_key = sk-123", origin: "x", souls: 1 }] }) }),
  );
  const capability = await capabilities.findByTestId("oats-capability-row");
  expect(capability.querySelector("span")!.textContent).toBe(`oats${GONE}core`);
  expect(capability.querySelector("p")!.textContent).toBe("[withheld]");
});

test("the spawn preview: each of the kernel's items is one filtered line", async () => {
  const slot = await page(
    "souls",
    "oats-developer",
    handlers({
      spawnPreview: () => ({ summary: { modules: ["oats.core\t2.6.0"], teams: [`oats${BIDI}`], launch: "claude ·\nopus", warnings: ["the hook printed token: abc123"], problems: ["no clone\nof the repository"] } }),
    }),
  );
  await slot.findByTestId("oats-spawn-form");
  fireEvent.change(slot.getByTestId("oats-spawn-name"), { target: { value: "ranker-v4-probe" } });
  fireEvent.change(slot.getByTestId("oats-spawn-task"), { target: { value: "Sweep." } });
  fireEvent.click(slot.getByTestId("oats-spawn-preview"));
  const preview = await slot.findByTestId("oats-preview");
  await waitFor(() => expect(Array.from(preview.querySelectorAll("li")).map((item) => item.textContent)).toEqual(["no clone of the repository", "[withheld]", "oats.core 2.6.0", `oats${GONE}`, "claude · opus"]));
});
