// @vitest-environment jsdom
// The Capabilities, Teams and Machines pages: what the kernel answers, listed; nothing acts.
import { afterEach, expect, test } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { fixtureAgents } from "../helpers/fixtures";
import { handlers, loadApp, resetApp, sidebarThreads, SOULS } from "../helpers/render";
import type { Contract, Handlers } from "../helpers/render";

afterEach(resetApp);

async function page(id: string, over: Partial<Handlers> = {}) {
  const app = await loadApp();
  const panel = app.navPanels.find((candidate) => candidate.id === id)!;
  expect(panel.path).toBe(id);
  expect(panel.experimental_hideFromNavigation).toBe(true); // opened from our thread list only
  return renderSlot<{ subPath: string }, Contract>(panel, { subPath: "" }, { rpc: handlers(over), sidebarThreads: sidebarThreads() });
}

test("the plugin registers the home and the four pages first, in that order", async () => {
  const app = await loadApp();
  // Another feature's page comes after these (its own test holds it).
  expect(app.navPanels.map((panel) => panel.path).slice(0, 5)).toEqual(["home", "souls", "capabilities", "teams", "machines"]);
});

// ---- ONE Workspace page, its tabs routes of their own (the ruling on the pages' audit, R1, R5) ----

test("the Workspace page's four tabs and the page itself are routes, each titled Workspace and out of bb's own navigation", async () => {
  const app = await loadApp();
  const mine = app.navPanels.filter((panel) => ["souls", "capabilities", "teams", "machines", "workspace"].includes(panel.path));
  expect(mine.map((panel) => [panel.path, panel.title, panel.experimental_hideFromNavigation])).toEqual([
    ["souls", "Workspace", true],
    ["capabilities", "Workspace", true],
    ["teams", "Workspace", true],
    ["machines", "Workspace", true],
    ["workspace", "Workspace", true],
  ]);
});

const tabsOf = (slot: Awaited<ReturnType<typeof page>>) => Array.from(slot.container.querySelectorAll('[role="tab"]')).map((tab) => [tab.textContent, tab.getAttribute("aria-selected")]);

test("a tab's page draws the strip over it: the four tabs in the Desktop's order, Souls and Capabilities with their count, the open one selected; a press goes to that tab's route", async () => {
  const slot = await page("teams");
  await slot.findAllByTestId("oats-team-row");
  // (Each count is the number of rows its own read answers: the handlers' souls and capabilities; Teams and Machines have none, as on the Desktop.)
  const souls = SOULS.length;
  await waitFor(() => expect(tabsOf(slot)).toEqual([[`Souls${souls}`, "false"], [expect.stringMatching(/^Capabilities\d+$/), "false"], ["Teams", "true"], ["Machines", "false"]]));
  expect(souls).toBeGreaterThan(0);
  expect(slot.getByRole("tablist").getAttribute("aria-label")).toBe("Workspace");
  expect(slot.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(slot.getByTestId("oats-tab-teams").id);
  fireEvent.click(slot.getByTestId("oats-tab-machines"));
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "machines" }]);
});

test("the Workspace route opens the first tab that is shown; only the tabs that are shown are in the strip; one tab alone has no strip", async () => {
  const app = await loadApp();
  const workspace = app.navPanels.find((candidate) => candidate.path === "workspace")!;
  const open = (pages: string) => renderSlot<{ subPath: string }, Contract>(workspace, { subPath: "" }, { rpc: handlers(), sidebarThreads: sidebarThreads(), settings: { pages } });
  const all = open("home souls capabilities teams machines");
  await all.findByTestId("oats-souls-page");
  all.unmount();
  const two = open("home, teams, machines");
  await two.findByTestId("oats-teams-page");
  expect(tabsOf(two).map(([label]) => label)).toEqual(["Teams", "Machines"]);
  two.unmount();
  const one = open("machines");
  await one.findByTestId("oats-machines-page");
  expect(one.container.querySelector('[role="tablist"]')).toBeNull();
  expect(one.container.querySelector('[role="tabpanel"]')).toBeNull();
  one.unmount();
  // With no tab shown the page is not shown either: its route answers the one line.
  const none = open("home");
  expect(none.getByTestId("oats-page-not-shown")).toBeTruthy();
});

test("Capabilities: id, description, origin and the number of souls", async () => {
  const slot = await page("capabilities", {
    capabilities: () => ({
      capabilities: [
        { id: "oats.core", description: "Day-to-day operation.", origin: "oats.framework 1.12.0", souls: 9 },
        { id: "oats.aweb", description: "", origin: "oats-aweb 1.28.0", souls: 1 },
      ],
    }),
  });
  const rows = await slot.findAllByTestId("oats-capability-row");
  expect(rows.map((row) => row.textContent)).toEqual([
    "oats.coreused by 9 soulsDay-to-day operation.from oats.framework 1.12.0",
    "oats.awebused by 1 soulfrom oats-aweb 1.28.0",
  ]);
  // (And the souls, for the Souls tab's count.)
  expect(slot.inspection.rpcCalls.map((call) => call.method).sort()).toEqual(["capabilities", "souls"]);
});

test("Teams: label, team id, default or not, and this deployment's agents in each", async () => {
  const slot = await page("teams", {
    teams: () => ({
      teams: [
        { label: "oats", team: "default:oats.aweb.ai", isDefault: true },
        { label: "wider", team: "wider:oats.aweb.ai", isDefault: false },
        { label: "shared", team: null, isDefault: false },
      ],
    }),
  });
  const rows = await slot.findAllByTestId("oats-team-row");
  await slot.findByText("8 agents");
  expect(rows.map((row) => row.textContent)).toEqual(["oatsdefault8 agentsdefault:oats.aweb.ai", "wider0 agentswider:oats.aweb.ai", "sharednot mapped"]);
});

test("Machines: this machine with its agents in bb and elsewhere, then what the kernel recorded; no check is run", async () => {
  const slot = await page("machines", {
    machines: () => ({
      machines: [
        { id: "falcon", route: null, isThisMachine: true, label: null, folder: null },
        { id: "kestrel", route: "ssh://kestrel.tailnet", isThisMachine: false, label: null, folder: "/srv/oats" },
      ],
    }),
  });
  const rows = await slot.findAllByTestId("oats-machine-row");
  // this machine has its own block: the list below holds the other servers only
  expect(rows.map((row) => row.textContent)).toEqual(["kestrelssh://kestrel.tailnet/srv/oats"]);
  expect(slot.getByText("Servers OATS knows").parentElement!.textContent).toBe("Servers OATS knows1");
  await slot.findByText("7 agents in bb · 1 agent elsewhere");
  expect(slot.getByTestId("oats-this-machine").textContent).toContain("falcon");
  // (The souls and the capabilities for their tabs' counts; no check of a machine.)
  expect(slot.inspection.rpcCalls.map((call) => call.method).sort()).toEqual(["capabilities", "machines", "snapshot", "souls"]);
});

test("an empty answer says so in one line", async () => {
  const slot = await page("capabilities", { capabilities: () => ({ capabilities: [] }) });
  expect((await slot.findByText("This deployment has no capabilities.")).tagName).toBe("P");
});

test("a failed read shows the message unchanged, and Retry rereads", async () => {
  let failing = true;
  const slot = await page("teams", {
    teams: () => {
      if (failing) throw new Error("E_OATS_NOT_JSON: oats teams printed something that is not JSON");
      return handlers().teams(null);
    },
  });
  expect((await slot.findByRole("alert")).textContent).toBe("E_OATS_NOT_JSON: oats teams printed something that is not JSONRetry");
  failing = false;
  fireEvent.click(slot.getByRole("button", { name: "Retry" }));
  expect(await slot.findAllByTestId("oats-team-row")).toHaveLength(1);
});

test("Machines with no other server says so in one line", async () => {
  const slot = await page("machines"); // the default answer holds this machine only
  expect((await slot.findByText("OATS has no other server recorded.")).tagName).toBe("P");
  expect(slot.queryAllByTestId("oats-machine-row")).toEqual([]);
});

// What a page draws of the roster (Machines: this machine and its agents; Teams: each team's
// count) is as old as the roster: while OATS cannot be read the page says so with the notice every
// place shows, above what it keeps; with no roster ever read, the notice in the roster's place.
const LAST = () => ({ at: new Date(Date.now() - 40 * 60_000).toISOString(), deployment: { root: "/abs/deployment", workspace: "oats", machine: "falcon" }, agents: fixtureAgents() });
const unread = (last: ReturnType<typeof LAST> | null) => () => ({ ok: false as const, at: new Date().toISOString(), code: "OATS_NOT_FOUND", message: "oats was not found on falcon: install OATS there", machine: "falcon", last });

test("Machines while OATS cannot be read after it was: the notice with the age, above the machine and its agents as last read", async () => {
  const slot = await page("machines", { snapshot: unread(LAST()) });
  const notice = await slot.findByRole("alert");
  expect(notice.querySelector("h3")!.textContent).toBe("OATS is not installed on falcon");
  expect(notice.textContent).toContain("Read 40 min ago.");
  expect(slot.getByTestId("oats-this-machine").textContent).toContain("7 agents in bb · 1 agent elsewhere");
  expect(notice.compareDocumentPosition(slot.getByText("7 agents in bb · 1 agent elsewhere")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("Machines with no roster ever read: the notice in a person's words, the code after them, Retry; no raw line", async () => {
  const slot = await page("machines", { snapshot: unread(null) });
  const notice = await slot.findByRole("alert");
  expect(notice.querySelector("h3")!.textContent).toBe("OATS is not installed on falcon");
  expect(notice.textContent!.indexOf("OATS_NOT_FOUND")).toBeGreaterThan(notice.textContent!.indexOf("Install OATS there"));
  expect(slot.getByRole("button", { name: "Retry" })).toBeTruthy();
  expect(slot.getByTestId("oats-this-machine").textContent).not.toContain("agents in bb");
});

test("Teams while OATS cannot be read after it was: the notice with the age, and the counts as last read", async () => {
  const slot = await page("teams", { snapshot: unread(LAST()) });
  const notice = await slot.findByRole("alert");
  expect(notice.textContent).toContain("Read 40 min ago.");
  expect((await slot.findAllByTestId("oats-team-row")).some((row) => /\d+ agents?/.test(row.textContent ?? ""))).toBe(true);
});

// The ONE rule of every "New agent" (the lead's ruling T10 on its reader's report, 24 Nov 2026): the sidebar's and the
// home's are held by it, so a button that is off in one place is never live in another.
test("New agent is held while the roster is the last one read and behind an oats the plugin does not work with; not while the CLI is not read", async () => {
  const { newAgentHeld } = await import("../../app/workspace/pages");
  const held = (stale: boolean, state?: string) => newAgentHeld(stale, state === undefined ? undefined : { state });
  // the roster as read: by where the installed oats stands
  expect(["tested", "newer", "older", "unknown", "newer-api"].map((state) => [state, held(false, state)])).toEqual([
    ["tested", false],
    ["newer", false], // newer than what was tested, with the JSON the plugin reads: it says so, and works
    ["older", true],
    ["unknown", true],
    ["newer-api", true],
  ]);
  // not read yet, or its read failed: nothing is known against it
  expect(held(false)).toBe(false);
  // the roster kept as last read holds it whatever the CLI
  expect([undefined, "tested", "newer", "older"].map((state) => held(true, state))).toEqual([true, true, true, true]);
});
