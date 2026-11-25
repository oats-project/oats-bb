// @vitest-environment jsdom
// The Workspace page's tabs and its Capabilities, Teams and Machines tabs, by the audit of the hidden
// pages and its ruling (25 Nov 2026): what the kernel answers, listed; nothing acts.
import { afterEach, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
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

test("the plugin registers the home and the Workspace page's four tabs first, in that order", async () => {
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

// The strip's keys: Left and Right choose the tab beside, and a tab is a ROUTE, a page of its own: the
// page that is drawn next puts the focus on its own selected tab, so that the keys go on from there.
test("Right on the strip goes to the next tab's route, and the next tab's page takes the focus on its selected tab; a tab drawn with no key before it takes no focus", async () => {
  const first = await page("capabilities");
  await first.findAllByTestId("oats-capability-row");
  const tab = first.getByTestId("oats-tab-capabilities");
  tab.focus();
  fireEvent.keyDown(tab, { key: "ArrowRight" });
  expect(first.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "teams" }]);
  first.unmount();
  // bb draws the route that was asked for: the Teams tab's own page.
  const next = await page("teams");
  await next.findAllByTestId("oats-team-row");
  expect(document.activeElement).toBe(next.getByTestId("oats-tab-teams"));
  next.unmount();
  // Opened by itself (a link, the sidebar): the page takes no focus.
  const plain = await page("machines");
  await plain.findAllByTestId("oats-machine-row");
  expect(document.activeElement).not.toBe(plain.getByTestId("oats-tab-machines"));
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

// ---- Capabilities ----

const CAPABILITIES = [
  { id: "oats.okf", description: "Knowledge.", origin: "package oats.okf v6.2.0", souls: 9, source: { kind: "package", label: "oats.okf" }, version: "6.2.0", layer: "knowledge", repoOnly: false },
  { id: "oats.build", description: "What the team adds to building a change.\nA second line the list does not need.", origin: "member github.com/awebai/oats @ e5b6c5ac", souls: 5, source: { kind: "member", label: "workspace" }, version: "4.0.2", layer: null, repoOnly: false },
  { id: "oats.desktop-ui", description: "", origin: "member github.com/awebai/oats @ e5b6c5ac", souls: 1, source: { kind: "member", label: "workspace" }, version: "1.0.0", layer: null, repoOnly: true },
];
const capabilityRows = (slot: Awaited<ReturnType<typeof page>>) => slot.getAllByTestId("oats-capability-row").map((row) => [Array.from(row.firstElementChild!.children).map((part) => part.textContent), within(row).queryByTestId("oats-capability-does")?.textContent ?? null]);

test("Capabilities: the three core places and what fills each; then each capability: its id, its tags, who made it, and ONE line of what it does; no count of souls, no origin, no sentence", async () => {
  const slot = await page("capabilities", { capabilities: () => ({ capabilities: CAPABILITIES }) });
  await slot.findAllByTestId("oats-capability-row");
  // Core: Knowledge, Messaging, Tasks, each with the capability that fills it, or "none".
  expect(Array.from(slot.getByTestId("oats-capabilities-core").querySelectorAll('[data-testid="oats-fact"]')).map((fact) => [fact.querySelector("dt")!.textContent, fact.querySelector("dd")!.textContent])).toEqual([
    ["Knowledge", "oats.okf"],
    ["Messaging", "none"],
    ["Tasks", "none"],
  ]);
  // Two capabilities of one place: BOTH are named (the read does not say which a soul gets: none is picked).
  slot.unmount();
  resetApp();
  const two = await page("capabilities", { capabilities: () => ({ capabilities: [...CAPABILITIES, { ...CAPABILITIES[0]!, id: "oats.jira", layer: "tasks" }, { ...CAPABILITIES[0]!, id: "oats.linear", layer: "tasks" }] }) });
  await two.findAllByTestId("oats-capability-row");
  expect(Array.from(two.getByTestId("oats-capabilities-core").querySelectorAll("dd")).map((value) => value.textContent)).toEqual(["oats.okf", "none", "oats.jira, oats.linear"]);
  two.unmount();
  resetApp();
  // A kernel that says nothing of core places: no Core part, and no "core" tag.
  const older = await page("capabilities", { capabilities: () => ({ capabilities: CAPABILITIES.map(({ layer: _layer, ...rest }) => rest) }) });
  await older.findAllByTestId("oats-capability-row");
  expect(older.queryByTestId("oats-capabilities-core")).toBeNull();
  expect(capabilityRows(older).map(([head]) => head)).toEqual([["oats.okf", "by oats.okf"], ["oats.build", "by workspace"], ["oats.desktop-ui", "repo only", "by workspace"]]);
});

test("the Capabilities tab's rows: each capability's id, its tags, who made it, and ONE line of what it does; no count of souls, no origin, no sentence", async () => {
  const slot = await page("capabilities", { capabilities: () => ({ capabilities: CAPABILITIES }) });
  await slot.findAllByTestId("oats-capability-row");
  expect(capabilityRows(slot)).toEqual([
    [["oats.okf", "core", "by oats.okf"], "Knowledge."],
    [["oats.build", "by workspace"], "What the team adds to building a change. A second line the list does not need."],
    [["oats.desktop-ui", "repo only", "by workspace"], null],
  ]);
  const does = within(slot.getAllByTestId("oats-capability-row")[1]!).getByTestId("oats-capability-does");
  expect([does.className.includes("truncate"), does.getAttribute("title")]).toEqual([true, "What the team adds to building a change. A second line the list does not need."]);
  const face = Array.from(slot.getByTestId("oats-capabilities-page").querySelectorAll("li, section")).map((part) => part.textContent).join(" ");
  expect(face).not.toMatch(/used by|\d+ souls?|from (package|member)|github\.com/);
  expect(slot.getByTestId("oats-tab-capabilities").getAttribute("aria-selected")).toBe("true");
  expect(slot.queryByTestId("oats-search")).toBeNull(); // three need no search
  // Nothing of this tab is the roster's: while OATS cannot be read it draws no notice of the roster (the sidebar has it).
  expect(slot.queryByTestId("oats-unreadable")).toBeNull();
});

test("what capabilities are is ONE disclosure, closed: the Desktop's words, and no paragraph on the page", async () => {
  const slot = await page("capabilities", { capabilities: () => ({ capabilities: CAPABILITIES }) });
  await slot.findAllByTestId("oats-capability-row");
  const about = slot.getByTestId("oats-capabilities-about") as HTMLDetailsElement;
  expect([about.open, about.querySelector("summary")!.textContent]).toEqual([false, expect.stringContaining("About capabilities")]);
  expect(about.textContent).toContain("A capability is a reusable bundle of skills, commands and instructions, given to every soul whose work needs it.");
  expect(Array.from(about.querySelectorAll("dt")).map((term) => term.textContent)).toEqual(["Workspace owned", "Repo owned", "Packages"]);
  expect(about.textContent).not.toContain("instance"); // the plugin's word is "agent"
  expect(slot.getByTestId("oats-capabilities-page").querySelectorAll("details")).toHaveLength(1);
});

test("a kernel that names no place and no source: the capabilities alone, with no Core part and no \"by\"", async () => {
  const slot = await page("capabilities"); // the old shape: id, description, origin, souls
  await slot.findAllByTestId("oats-capability-row");
  expect(slot.queryByTestId("oats-capabilities-core")).toBeNull();
  expect(capabilityRows(slot)).toEqual([[["oats.core"], "Day-to-day operation."]]);
});

test("from twelve capabilities on there is a search field; while it narrows the list the tab says how many of how many; nothing found, and none at all, are two words each", async () => {
  const many = Array.from({ length: 12 }, (_, index) => ({ ...CAPABILITIES[1]!, id: `cap.${index + 1}`, description: index === 2 ? "Reviews." : "" }));
  const slot = await page("capabilities", { capabilities: () => ({ capabilities: many }) });
  await slot.findAllByTestId("oats-capability-row");
  const search = slot.getByTestId("oats-search") as HTMLInputElement;
  expect([search.getAttribute("aria-label"), search.placeholder]).toEqual(["Search capabilities", "Search capabilities"]);
  expect(slot.getByTestId("oats-tab-capabilities").textContent).toBe("Capabilities12");
  fireEvent.change(search, { target: { value: "reviews" } });
  expect(capabilityRows(slot).map(([head]) => (head as string[])[0])).toEqual(["cap.3"]);
  expect(slot.getByTestId("oats-tab-capabilities").textContent).toBe("Capabilities1 of 12");
  expect(slot.queryByTestId("oats-capabilities-core")).toBeNull(); // a search shows what it found
  fireEvent.change(search, { target: { value: "zzz" } });
  expect(slot.getByText("Nothing matches.").tagName).toBe("P");
  slot.unmount();
  resetApp();
  const none = await page("capabilities", { capabilities: () => ({ capabilities: [] }) });
  expect((await none.findByText("No capabilities.")).tagName).toBe("P");
});

// ---- Teams ----

const TEAMS = {
  teams: [
    { label: "oats", team: "default:oats.aweb.ai", isDefault: true, description: "The OATS framework team", local: false, at: "github.com/awebai/oats:oats-workspace.yaml#/teams/oats" },
    { label: "docs", team: null, isDefault: false, description: null, local: false, at: "github.com/awebai/oats:oats-workspace.yaml#/teams/docs" },
  ],
  localTeams: true,
  problems: [{ code: "team-unmapped", label: "docs", isDefault: false, message: "shared team docs has no provider id yet", fix: "its owner runs `oats aweb setup`, then commits the id" }],
};
/** The souls as `oats souls` answers them, each with the teams the kernel RESOLVED for it (its default first). */
const joiner = (name: string, teams: string[] | undefined, first = teams?.[0]) => ({ name, agent: name, description: "", origin: "", capabilities: [], spawnable: true, problem: null, ...(teams === undefined ? {} : { teams: teams.map((label) => ({ label, isDefault: label === first })) }) });
const JOIN = { souls: () => ({ souls: [joiner("code-reviewer", ["oats"]), joiner("oats-developer", ["oats", "docs"]), joiner("oats-expert", ["oats"])] }) };
const teamRows = (slot: Awaited<ReturnType<typeof page>>) => slot.getAllByTestId("oats-team-row").map((row) => [Array.from(row.firstElementChild!.children).map((part) => part.textContent), row.querySelector(":scope > p")?.textContent ?? null, Array.from(row.querySelectorAll("details p")).map((line) => line.textContent)]);

test("Teams: each team's label, \"Default team\", how many of this deployment's agents are on it, and what it is for; its address, who may join and where it is declared are under its Details", async () => {
  const slot = await page("teams", { teams: () => TEAMS, ...JOIN });
  await slot.findAllByTestId("oats-team-row");
  await waitFor(() =>
    expect(teamRows(slot)).toEqual([
      [["oats", "Default team", "8 agents"], "The OATS framework team", ["Address: default:oats.aweb.ai", "May join: every soul", "Declared in: github.com/awebai/oats:oats-workspace.yaml#/teams/oats"]],
      // A team with no address on the provider yet says so, in the warning tone, in the kernel's place of an id; "not mapped" is said nowhere.
      [["docs", "No address yet"], null, ["May join: oats-developer", "Declared in: github.com/awebai/oats:oats-workspace.yaml#/teams/docs"]],
    ]),
  );
  for (const details of Array.from(slot.container.querySelectorAll<HTMLDetailsElement>('[data-testid="oats-team-details"]'))) expect(details.open).toBe(false);
  expect(slot.getByTestId("oats-teams-page").textContent).not.toContain("not mapped");
  // One list, with no heading: every team is the workspace's.
  expect(slot.queryByTestId("oats-teams-shared")).toBeNull();
  // Which teams each soul may join: one fold, closed.
  const fold = slot.getByTestId("oats-teams-may-join") as HTMLDetailsElement;
  expect([fold.open, Array.from(fold.querySelectorAll("p")).map((line) => line.textContent)]).toEqual([false, ["code-reviewer: oats", "oats-developer: oats, docs", "oats-expert: oats"]]);
  // A team that is not the default and has no address stops nothing: no notice, and no mark on the Teams tab.
  expect(slot.queryByTestId("oats-notice")).toBeNull();
  expect(slot.getByTestId("oats-tab-teams").querySelector('[data-testid="oats-mark"]')).toBeNull();
});

// Who joins a team is what the kernel RESOLVED for each soul (`oats souls`), never the plugin's reading of the
// workspace's rules: a default team and no rule at all, a team of this computer, a default of one soul alone.
test("who may join is each soul's teams as the kernel resolved them: every soul, every soul but a few, the souls, no soul; and whose default a team is, where it is not the deployment's", async () => {
  const may = (slot: Awaited<ReturnType<typeof page>>) => teamRows(slot).map((row) => (row[2] as string[]).filter((line) => /^(May join|Default for)/.test(line)));
  // docs is oats-developer's DEFAULT (and not the deployment's); every soul is on oats but one.
  const souls = [joiner("code-reviewer", ["oats"]), joiner("oats-developer", ["docs", "oats"]), joiner("oats-expert", ["oats"]), joiner("writer", ["docs"])];
  const slot = await page("teams", { teams: () => TEAMS, souls: () => ({ souls }) });
  await slot.findAllByTestId("oats-team-row");
  await waitFor(() => expect(may(slot)).toEqual([["May join: every soul but writer"], ["May join: oats-developer, writer", "Default for: oats-developer, writer"]]));
  slot.unmount();
  resetApp();
  // Every soul on the default team and none on the other: said so; "Default for" is never said of the deployment's default.
  const all = await page("teams", { teams: () => TEAMS, souls: () => ({ souls: [joiner("code-reviewer", ["oats"]), joiner("oats-expert", ["oats"])] }) });
  await all.findAllByTestId("oats-team-row");
  await waitFor(() => expect(may(all)).toEqual([["May join: every soul"], ["May join: no soul"]]));
  all.unmount();
  resetApp();
  // A soul the kernel could not resolve (no teams answered) is left out of the claim; with no soul's teams known, nothing is claimed at all, and there is no fold.
  const some = await page("teams", { teams: () => TEAMS, souls: () => ({ souls: [joiner("code-reviewer", ["oats"]), joiner("broken", undefined)] }) });
  await some.findAllByTestId("oats-team-row");
  await waitFor(() => expect(may(some)).toEqual([["May join: every soul"], ["May join: no soul"]]));
  expect(Array.from(some.getByTestId("oats-teams-may-join").querySelectorAll("p")).map((line) => line.textContent)).toEqual(["code-reviewer: oats"]);
  some.unmount();
  resetApp();
  const none = await page("teams", { teams: () => TEAMS, souls: () => ({ souls: [joiner("broken", undefined)] }) });
  await none.findAllByTestId("oats-team-row");
  expect(may(none)).toEqual([[], []]);
  expect(none.queryByTestId("oats-teams-may-join")).toBeNull();
});

test("the default team with no address is said first, as a notice: nothing can be spawned; the kernel's words and its remedy are one press away", async () => {
  const unmapped = { ...TEAMS, teams: [{ ...TEAMS.teams[1]!, isDefault: true }], problems: [{ ...TEAMS.problems[0]!, isDefault: true }] };
  const slot = await page("teams", { teams: () => unmapped });
  const notice = await slot.findByTestId("oats-notice");
  expect(notice.querySelector("h3")!.textContent).toBe("The default team docs has no address yet: nothing can be spawned until it has one.");
  expect(notice.getAttribute("data-tone")).toBe("warning");
  const details = within(notice).getByTestId("oats-notice-details") as HTMLDetailsElement;
  expect([details.open, Array.from(details.querySelectorAll("p")).map((line) => line.textContent)]).toEqual([false, ["shared team docs has no provider id yet", "its owner runs `oats aweb setup`, then commits the id"]]);
  expect(notice.compareDocumentPosition(slot.getByTestId("oats-team-row")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // The Teams tab is marked for it, with words a screen reader says (the Desktop's dot on that tab).
  const mark = slot.getByTestId("oats-tab-teams").querySelector('[data-testid="oats-mark"]')!;
  expect([mark.getAttribute("role"), mark.getAttribute("aria-label")]).toEqual(["img", "Teams: the default team has no address yet"]);
  slot.unmount();
  resetApp();
  // Decided on the kernel's CODE for it: another problem of the default team is no such notice and no mark.
  const other = await page("teams", { teams: () => ({ ...unmapped, problems: [{ ...unmapped.problems[0]!, code: "team-something-else" }] }) });
  await other.findAllByTestId("oats-team-row");
  expect(other.queryByTestId("oats-notice")).toBeNull();
  expect(other.getByTestId("oats-tab-teams").querySelector('[data-testid="oats-mark"]')).toBeNull();
  other.unmount();
  resetApp();
  // One notice on a screen: while OATS cannot be read the roster's notice stands, and this one waits.
  const stale = await page("teams", { teams: () => unmapped, snapshot: unread(LAST()) });
  await stale.findAllByTestId("oats-team-row");
  expect(stale.getAllByTestId("oats-unreadable")).toHaveLength(1);
  expect(stale.queryByText(/has no address yet: nothing can be spawned/)).toBeNull();
});

test("the workspace's teams and this computer's own stand under a heading each, only where both are there", async () => {
  const both = { ...TEAMS, teams: [TEAMS.teams[0]!, { label: "mine", team: "mine:oats.aweb.ai", isDefault: false, description: null, local: true, at: "oats-local.yaml#/teams/mine" }] };
  const slot = await page("teams", { teams: () => both });
  await slot.findAllByTestId("oats-team-row");
  expect([slot.getByTestId("oats-teams-shared").querySelector("h2")!.textContent, within(slot.getByTestId("oats-teams-shared")).getAllByTestId("oats-team-row").map((row) => row.firstElementChild!.firstElementChild!.textContent)]).toEqual(["Workspace", ["oats"]]);
  expect([slot.getByTestId("oats-teams-local").querySelector("h2")!.textContent, within(slot.getByTestId("oats-teams-local")).getAllByTestId("oats-team-row").map((row) => row.firstElementChild!.firstElementChild!.textContent)]).toEqual(["This computer", ["mine"]]);
});

test("a kernel that says a team's label, id and default alone: the row, with its address under Details, and no fold of who may join; no team: two words", async () => {
  const slot = await page("teams"); // the old shape
  await slot.findAllByTestId("oats-team-row");
  await waitFor(() => expect(teamRows(slot)).toEqual([[["oats", "Default team", "8 agents"], null, ["Address: default:oats.aweb.ai"]]]));
  expect(slot.queryByTestId("oats-teams-may-join")).toBeNull();
  slot.unmount();
  resetApp();
  const none = await page("teams", { teams: () => ({ teams: [] }) });
  expect((await none.findByText("No teams.")).tagName).toBe("P");
});

test("a read that failed is a notice in a person's words with Retry, the kernel's message one press away; Retry reads again", async () => {
  let failing = true;
  const slot = await page("teams", {
    teams: () => {
      if (failing) throw new Error("E_OATS_NOT_JSON: oats teams printed something that is not JSON");
      return handlers().teams(null);
    },
  });
  const notice = await slot.findByRole("alert");
  expect(Array.from(notice.children).filter((part) => part.tagName !== "DETAILS").map((part) => part.textContent)).toEqual(["OATS could not be read", "Retry"]);
  expect(within(notice).getByTestId("oats-notice-details").textContent).toContain("E_OATS_NOT_JSON: oats teams printed something that is not JSON");
  failing = false;
  fireEvent.click(within(notice).getByRole("button", { name: "Retry" }));
  expect(await slot.findAllByTestId("oats-team-row")).toHaveLength(1);
});

// ---- Machines ----

const machineRows = (slot: Awaited<ReturnType<typeof page>>) => slot.getAllByTestId("oats-machine-row").map((row) => [Array.from(row.firstElementChild!.children).map((part) => part.textContent), Array.from(row.querySelectorAll("details p")).map((line) => line.textContent)]);

test("Machines: ONE list: this computer first, by its name, with its agents; then each machine OATS has registered, by its name; the id, the ssh host and the folder are under Details; no check is run", async () => {
  const slot = await page("machines", {
    machines: () => ({
      machines: [
        { id: "falcon", route: null, isThisMachine: true, label: null, folder: "/abs/deployment" },
        { id: "devbox-oats", route: "devbox.invalid", isThisMachine: false, label: "devbox", folder: "/srv/oats" },
        { id: "build", route: "build.invalid", isThisMachine: false, label: null, folder: null },
      ],
    }),
  });
  await slot.findAllByTestId("oats-machine-row");
  await waitFor(() =>
    expect(machineRows(slot)).toEqual([
      [["falcon", "this computer", "8 agents"], ["Folder: /abs/deployment"]],
      // A machine by its name; its id in the registry is under Details where the name is another.
      [["devbox"], ["Id: devbox-oats", "ssh host: devbox.invalid", "Folder: /srv/oats"]],
      [["build"], ["ssh host: build.invalid"]],
    ]),
  );
  expect(slot.getAllByTestId("oats-machine-row").map((row) => row.hasAttribute("data-this"))).toEqual([true, false, false]);
  // No heading, no sentence, nothing of the registry's bookkeeping.
  expect(slot.getByTestId("oats-machines-page").querySelectorAll("h2")).toHaveLength(0);
  expect(slot.getByTestId("oats-machines-page").textContent).not.toMatch(/Servers OATS knows|saved instance routes|elsewhere|in bb/);
  // (The souls and the capabilities for their tabs' counts, the teams for the Teams tab's mark; no check of a machine.)
  expect(slot.inspection.rpcCalls.map((call) => call.method).sort()).toEqual(["capabilities", "machines", "snapshot", "souls", "teams"]);
});

test("with this computer alone the list is its one row and nothing more; with no machine at all: two words", async () => {
  const slot = await page("machines"); // the default answer holds this machine only
  await slot.findAllByTestId("oats-machine-row");
  await waitFor(() => expect(machineRows(slot)).toEqual([[["falcon", "this computer", "8 agents"], []]]));
  expect(slot.getByTestId("oats-machines-page").textContent).not.toMatch(/No other|no other/);
  slot.unmount();
  resetApp();
  const none = await page("machines", { machines: () => ({ machines: [] }) });
  expect((await none.findByText("No machines.")).tagName).toBe("P");
});

// What a tab draws of the roster (Machines: this computer's name and its agents; Teams: each team's
// count) is as old as the roster: while OATS cannot be read the tab says so with the notice every
// place shows, above what it keeps; with no roster ever read, the notice in the roster's place.
const LAST = () => ({ at: new Date(Date.now() - 40 * 60_000).toISOString(), deployment: { root: "/abs/deployment", workspace: "oats", machine: "falcon" }, agents: fixtureAgents() });
const unread = (last: ReturnType<typeof LAST> | null) => () => ({ ok: false as const, at: new Date().toISOString(), code: "OATS_NOT_FOUND", message: "oats was not found on falcon: install OATS there", machine: "falcon", last });

test("Machines while OATS cannot be read after it was: the notice with the age, above this computer and its agents as last read", async () => {
  const slot = await page("machines", { snapshot: unread(LAST()) });
  const notice = await slot.findByRole("alert");
  expect(notice.querySelector("h3")!.textContent).toBe("OATS is not installed on falcon");
  expect(notice.textContent).toContain("Read 40 min ago.");
  await waitFor(() => expect(machineRows(slot)[0]![0]).toEqual(["falcon", "this computer", "8 agents"]));
  expect(notice.compareDocumentPosition(slot.getByTestId("oats-machine-row")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(slot.getAllByTestId("oats-unreadable")).toHaveLength(1);
});

test("Machines with no roster ever read: the notice in a person's words, the code after them, Retry; this computer by the name the server knows, with no count", async () => {
  const slot = await page("machines", { snapshot: unread(null) });
  const notice = await slot.findByRole("alert");
  expect(notice.querySelector("h3")!.textContent).toBe("OATS is not installed on falcon");
  expect(notice.textContent!.indexOf("OATS_NOT_FOUND")).toBeGreaterThan(notice.textContent!.indexOf("Install OATS there"));
  expect(slot.getByRole("button", { name: "Retry" })).toBeTruthy();
  await waitFor(() => expect(machineRows(slot)[0]![0]).toEqual(["falcon", "this computer"]));
});

test("Teams while OATS cannot be read after it was: the notice with the age, and the counts as last read", async () => {
  const slot = await page("teams", { snapshot: unread(LAST()) });
  const notice = await slot.findByRole("alert");
  expect(notice.textContent).toContain("Read 40 min ago.");
  expect((await slot.findAllByTestId("oats-team-row")).some((row) => /\d+ agents?/.test(row.textContent ?? ""))).toBe(true);
});
