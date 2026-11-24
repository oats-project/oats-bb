// @vitest-environment jsdom
// A8: the Sidebar (experimental_threadList) with the pinned fixtures.
import { afterEach, expect, test } from "vitest";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { addPageLink } from "../../app/workspace/pages";
import { fixtureAgents, fixtureSnapshot, fixtureThreads } from "../helpers/fixtures";
import { ALL_PAGES, handlers, loadApp, resetApp, sidebarThreads } from "../helpers/render";
import type { Contract, Handlers } from "../helpers/render";

afterEach(resetApp);

async function sidebar(over: Partial<Handlers> = {}, activeThreadId: string | null = null, threads = sidebarThreads()) {
  const app = await loadApp();
  expect(app.threadLists.map((list) => list.id)).toEqual(["agents"]);
  let navigated = 0;
  const slot = renderSlot<PluginThreadListProps, Contract>(
    app.threadLists[0]!,
    { activeThreadId, activeProjectId: null, isCompactViewport: false, onNavigate: () => void navigated++, searchQuery: "" },
    { rpc: handlers(over), sidebarThreads: threads },
  );
  return { slot, navigated: () => navigated };
}

/** The roster's own reads and asks, in order: a row another feature added to the block reads for itself. */
const rosterCalls = (slot: Awaited<ReturnType<typeof sidebar>>["slot"]) => slot.inspection.rpcCalls.map((call) => call.method).filter((method) => method === "snapshot" || method === "refresh");

const ids = (rows: HTMLElement[]) => rows.map((row) => row.getAttribute("data-sidebar-thread-id"));

/**
 * Every parent of the tree opened, as a person does with its chevron: a parent's children are
 * closed when the page loads (the test "children are collapsed by default" below pins that), and a test that reads a child's row opens them first.
 */
async function openParents(slot: { findByTestId: (id: string) => Promise<HTMLElement>; container: HTMLElement }) {
  await slot.findByTestId("oats-tree");
  for (;;) {
    const closed = slot.container.querySelector<HTMLElement>('[data-testid="oats-row-toggle"][aria-expanded="false"]');
    if (closed === null) return;
    fireEvent.click(closed);
  }
}

test("the tree: every bb agent has a row with both data-sidebar-thread-* attributes and its href", async () => {
  const { slot } = await sidebar();
  await openParents(slot);
  const rows = await slot.findAllByTestId("oats-agent-row");
  // needs-you first (newest first), then working with its children under it, then the rest
  expect(ids(rows)).toEqual(["thr_release", "thr_ci", "thr_research", "thr_redesign", "thr_mockups", "thr_harvest", "thr_digest"]);
  for (const row of rows) {
    expect(row.tagName).toBe("A");
    expect(row.getAttribute("data-sidebar-thread-shortcut-target")).toBe("");
    const id = row.getAttribute("data-sidebar-thread-id")!;
    expect(row.getAttribute("href")).toBe(fixtureThreads().find((thread) => thread.id === id)!.href);
  }
});

test("a row is two blocks: its name, then on one line its state in a word and its soul; the mark sits beside the word, and no ? or new", async () => {
  const { slot } = await sidebar();
  await openParents(slot);
  const rows = await slot.findAllByTestId("oats-agent-row");
  const row = (id: string) => rows.find((candidate) => candidate.getAttribute("data-sidebar-thread-id") === id)!;
  const facts = (id: string) => within(row(id)).getByTestId("oats-row-facts").textContent;
  const mark = (id: string) => row(id).querySelector("[data-mark]")!;

  expect(row("thr_release").textContent).toContain("Release 070 maintainer"); // the instance name as words, never bb's title for the thread (R1)
  // The state's word, then the soul (Joan's word of 24 Nov: "Keep the agent type").
  expect(facts("thr_release")).toBe("Needs you · oats-maintainer");
  expect(facts("thr_ci")).toBe("Needs you · oats-developer"); // a claim, and a bb pending interaction
  expect(facts("thr_redesign")).toBe("Working · oats-product-expert");
  expect(facts("thr_harvest")).toBe("Idle · knowledge-harvester");
  expect(facts("thr_digest")).toBe("Stopped · oats-expert");
  for (const one of rows) {
    const line = within(one).getByTestId("oats-row-facts");
    expect(line.getAttribute("title")).toBe(line.textContent);
    expect(line.querySelector('[data-phrase="soul"]')!.textContent).not.toBe("");
    // When the line is short of room the SOUL alone gives way, with "…": the state, a reason and where it is never shrink.
    for (const part of Array.from(line.querySelectorAll("[data-phrase]"))) {
      const classes = part.className.split(/\s+/);
      if (part.getAttribute("data-phrase") === "soul") expect(classes).toEqual(expect.arrayContaining(["shrink", "truncate", "min-w-[1.5em]"]));
      else expect([classes.includes("shrink-0"), classes.includes("truncate")]).toEqual([true, false]);
    }
  }
  // The mark says the state too, and is hidden from a screen reader beside its word.
  for (const [id, state] of [["thr_release", "needs-you"], ["thr_redesign", "working"], ["thr_harvest", "idle"], ["thr_digest", "stopped"]] as const) {
    expect(mark(id).getAttribute("data-state")).toBe(state);
    expect(mark(id).getAttribute("aria-hidden")).toBe("true");
  }
  expect(mark("thr_release").textContent).toBe("!"); // the Desktop's mark for an agent that waits
  for (const one of rows) expect(one.textContent).not.toMatch(/(\?|new)$/);
  // The name is bold while the agent waits on a person, read or not.
  expect(row("thr_release").querySelector(".font-semibold")).not.toBeNull();
});

test("two failures are two words: Failed for a session that ended, Unreachable for one the kernel cannot reach", async () => {
  const agents = fixtureAgents().map((agent) => (agent.instance === "harvest-knowledge-helper" ? { ...agent, runtimeState: "shell" } : agent.instance === "weekly-digest-helper" ? { ...agent, running: null, runtimeState: "unreachable" } : agent));
  const { slot } = await sidebar({ snapshot: () => ({ ok: true, at: new Date().toISOString(), deployment: { root: "/abs/deployment", workspace: "oats", machine: "falcon" }, agents }) });
  await openParents(slot);
  const rows = await slot.findAllByTestId("oats-agent-row");
  const facts = (id: string) => within(rows.find((row) => row.getAttribute("data-sidebar-thread-id") === id)!).getByTestId("oats-row-facts").textContent;
  expect(facts("thr_harvest")).toBe("Failed · knowledge-harvester");
  expect(facts("thr_digest")).toBe("Unreachable · oats-expert");
});

test("an agent with no bb thread stays in the roster: one that runs in tmux, and one whose thread bb does not list; each opens its own page", async () => {
  const { slot, navigated } = await sidebar({}, null, { status: "ready", threads: fixtureThreads().filter((thread) => thread.id !== "thr_digest") });
  await openParents(slot);
  const rows = await slot.findAllByTestId("oats-agent-row-threadless");
  expect(rows.map((row) => [row.getAttribute("data-instance"), within(row).getByTestId("oats-row-facts").textContent])).toEqual([
    // Where its thread is (archived in bb, or deleted) is bb's own answer, which the outside feature asks and says (test/outside/places.test.tsx); bb says nothing here.
    // (In the kernel's order, as every row of their rank: the one on tmux is listed before the stopped one.)
    ["kernel-fix-developer", "Working · oats-developer · tmux"],
    ["weekly-digest-helper", "Stopped · oats-expert"],
  ]);
  expect(rows[0]!.textContent).toContain("Kernel fix developer");
  // (That neither is in a block of its own after the tree is the model's table: test/model/order.test.ts.)
  // The workspace's name alone heads the roster (no machine, no count); every agent is a row.
  expect(slot.getByTestId("oats-workspace-line").textContent).toBe("oats");
  expect(slot.getAllByTestId("oats-agent-row").length + rows.length).toBe(8);
  fireEvent.click(rows[1]!);
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "agent", options: { subPath: "weekly-digest-helper" } }]); // the agent's own page, where its acts are
  expect(navigated()).toBe(1);
});

test("children are indented one step under their parent", async () => {
  const { slot } = await sidebar();
  await openParents(slot);
  const rows = await slot.findAllByTestId("oats-agent-row");
  const cls = (id: string) => rows.find((row) => row.getAttribute("data-sidebar-thread-id") === id)!.className;
  // A roster with a parent in it keeps a gutter for the chevron before every row: a root at one step, a child at two.
  expect(cls("thr_release").split(/\s+/)).toContain("pl-6");
  expect(cls("thr_redesign").split(/\s+/)).toContain("pl-6");
  expect(cls("thr_mockups").split(/\s+/)).toContain("pl-10");
  expect(cls("thr_harvest").split(/\s+/)).toContain("pl-10");
  expect(slot.getByTestId("oats-agent-row-threadless").className.split(/\s+/)).toContain("pl-6");
});

// ---- the fold: children collapsed by default (Joan, 24 Nov 2026). The rows drawn are the model's (test/model/fold.test.ts).

const LEAD = "thr_redesign"; // redesign-ui-lead: the sample's one parent, of desktop-mockups-developer (thr_mockups) and harvest-knowledge-helper (thr_harvest)
const rowOn = (slot: { container: HTMLElement }, thread: string) => slot.container.querySelector<HTMLElement>(`[data-testid="oats-agent-row"][data-sidebar-thread-id="${thread}"]`);
const toggles = (slot: { container: HTMLElement }) => Array.from(slot.container.querySelectorAll<HTMLElement>('[data-testid="oats-row-toggle"]'));

test("children are collapsed by default: a parent has ONE chevron before its name, a button of its own that says whose agents it shows; one press opens it, one more closes it", async () => {
  const { slot, navigated } = await sidebar();
  await slot.findByTestId("oats-tree");
  // On load: the roots alone. Nothing of the closed parent's children is in the page, so nothing of them takes the focus.
  expect(ids(slot.getAllByTestId("oats-agent-row"))).toEqual(["thr_release", "thr_ci", "thr_research", "thr_redesign", "thr_digest"]);
  expect([rowOn(slot, "thr_mockups"), rowOn(slot, "thr_harvest")]).toEqual([null, null]);
  expect(slot.getByTestId("oats-tree").textContent).not.toMatch(/Desktop mockups developer|Harvest knowledge helper/);
  // ONE chevron in the whole roster: the one parent's. No count beside it.
  expect(toggles(slot)).toHaveLength(1);
  const chevron = toggles(slot)[0]!;
  const lead = rowOn(slot, LEAD)!;
  expect([chevron.tagName, chevron.getAttribute("type"), chevron.getAttribute("data-instance")]).toEqual(["BUTTON", "button", "redesign-ui-lead"]);
  expect([chevron.getAttribute("aria-expanded"), chevron.getAttribute("aria-label")]).toEqual(["false", "Show Redesign ui lead's agents"]);
  expect(chevron.textContent).toBe("▸"); // the pattern book's mark for something that opens, and nothing else: no number
  // A button of its own: in the row's <li>, before the row's link (so before it in the tab order), never inside the link.
  expect(chevron.closest("li")).toBe(lead.closest("li"));
  expect(lead.contains(chevron)).toBe(false);
  expect(chevron.compareDocumentPosition(lead) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(chevron.tabIndex).toBe(0);
  expect(chevron.className.split(/\s+/)).toEqual(expect.arrayContaining(["h-full", "w-6"])); // as high as the row, which is as high as a control
  // One press opens: the children are rows under it, and the button says so.
  fireEvent.click(chevron);
  expect(ids(slot.getAllByTestId("oats-agent-row"))).toEqual(["thr_release", "thr_ci", "thr_research", "thr_redesign", "thr_mockups", "thr_harvest", "thr_digest"]);
  expect([toggles(slot)[0]!.getAttribute("aria-expanded"), toggles(slot)[0]!.getAttribute("aria-label")]).toEqual(["true", "Hide Redesign ui lead's agents"]);
  // The press is the chevron's own: it opens no thread.
  expect([slot.inspection.navigateCalls, navigated()]).toEqual([[], 0]);
  // One more closes it.
  fireEvent.click(toggles(slot)[0]!);
  expect(ids(slot.getAllByTestId("oats-agent-row"))).toEqual(["thr_release", "thr_ci", "thr_research", "thr_redesign", "thr_digest"]);
  expect(toggles(slot)[0]!.getAttribute("aria-expanded")).toBe("false");
});

test("Right on a parent's row opens it and Left closes it, as a tree's keys do; on any other row, and with a modifier, they are not the fold's", async () => {
  const { slot } = await sidebar();
  await slot.findByTestId("oats-tree");
  const open = () => toggles(slot)[0]!.getAttribute("aria-expanded");
  const key = (thread: string, init: KeyboardEventInit) => fireEvent.keyDown(rowOn(slot, thread)!, init); // false: the row took the key (preventDefault)
  expect(key(LEAD, { key: "ArrowLeft" })).toBe(true); // closed already: not taken
  expect(key(LEAD, { key: "ArrowRight", shiftKey: true })).toBe(true);
  expect(key("thr_release", { key: "ArrowRight" })).toBe(true); // no parent: not its key
  expect(open()).toBe("false");
  expect(key(LEAD, { key: "ArrowRight" })).toBe(false);
  expect(open()).toBe("true");
  expect(rowOn(slot, "thr_mockups")).not.toBeNull();
  expect(key(LEAD, { key: "ArrowRight" })).toBe(true); // open already: not taken (bb's own keys stay bb's)
  expect(key("thr_mockups", { key: "ArrowLeft" })).toBe(true); // a child with no children of its own
  expect(open()).toBe("true");
  expect(key(LEAD, { key: "ArrowLeft" })).toBe(false);
  expect([open(), rowOn(slot, "thr_mockups")]).toEqual(["false", null]);
});

test("a closed parent whose subtree holds a row that needs a person carries that row's mark after its own state, which stays its own; open, or over quiet children, it carries none", async () => {
  const claim = { reason: "attention" as const, message: "Which mockup?", since: "2026-11-19T12:00:00.000Z" };
  const agents = fixtureAgents().map((agent) => (agent.instance === "desktop-mockups-developer" ? { ...agent, waiting: claim } : agent));
  const { slot } = await sidebar({ snapshot: () => fixtureSnapshot(agents) });
  await slot.findByTestId("oats-tree");
  const lead = rowOn(slot, LEAD)!;
  // Its own state, mark and word, unchanged: it works. Then the hidden row's mark, named.
  expect(within(lead).getByTestId("oats-row-facts").querySelector('[data-phrase="state"]')!.textContent).toBe("Working");
  expect(lead.querySelector("[data-mark]")!.getAttribute("data-state")).toBe("working");
  const inside = within(lead).getByTestId("oats-row-inside").querySelector("[data-mark]")!;
  expect([inside.getAttribute("data-state"), inside.getAttribute("role"), inside.getAttribute("aria-label")]).toEqual(["needs-you", "img", "Needs input"]);
  // It stands after the state's word and before the soul.
  expect(within(lead).getByTestId("oats-row-inside").previousElementSibling!.getAttribute("data-phrase")).toBe("state");
  expect(within(lead).getByTestId("oats-row-facts").textContent).toBe("Working! · oats-product-expert");
  // Opened: the row itself is in sight with its own mark, and the parent carries none.
  fireEvent.click(toggles(slot)[0]!);
  expect(within(rowOn(slot, LEAD)!).queryByTestId("oats-row-inside")).toBeNull();
  expect(rowOn(slot, "thr_mockups")!.querySelector("[data-mark]")!.getAttribute("data-state")).toBe("needs-you");
  cleanup();
  resetApp();
  // Quiet children (the sample's: one works, one is idle): no mark on the closed parent.
  const quiet = await sidebar();
  await quiet.slot.findByTestId("oats-tree");
  expect(within(rowOn(quiet.slot, LEAD)!).queryByTestId("oats-row-inside")).toBeNull();
});

test("the parent of the thread on screen is open and its chevron is OFF (never a button that swallows a press): disabled, out of the tab order, named as open; once another thread is on screen it is live, and as the person left it", async () => {
  const child = await sidebar({}, "thr_mockups");
  await child.slot.findByTestId("oats-tree");
  expect(rowOn(child.slot, "thr_mockups")!.getAttribute("aria-current")).toBe("page");
  const off = toggles(child.slot)[0] as HTMLButtonElement;
  // Drawn open, and off in the pattern book's form for an off control: disabled (so no press and no focus), and its name says what is so, not an act.
  expect([off.getAttribute("aria-expanded"), off.disabled, off.getAttribute("aria-disabled"), off.getAttribute("aria-label")]).toEqual(["true", true, "true", "Redesign ui lead's agents shown"]);
  expect(off.className.split(/\s+/)).toEqual(expect.arrayContaining(["disabled:opacity-50", "disabled:cursor-not-allowed"]));
  off.focus();
  expect(document.activeElement).not.toBe(off);
  // A press does nothing, and neither does Left on its row: the row the person is on stays.
  fireEvent.click(off);
  expect(fireEvent.keyDown(rowOn(child.slot, LEAD)!, { key: "ArrowLeft" })).toBe(true);
  expect([toggles(child.slot)[0]!.getAttribute("aria-expanded"), rowOn(child.slot, "thr_mockups") !== null]).toEqual(["true", true]);
  cleanup();
  // The same window, the PARENT's own thread on screen: the chevron is live (nothing is above the row on screen).
  const own = await sidebar({}, LEAD);
  await own.slot.findByTestId("oats-tree");
  expect([(toggles(own.slot)[0] as HTMLButtonElement).disabled, toggles(own.slot)[0]!.getAttribute("aria-disabled"), toggles(own.slot)[0]!.getAttribute("aria-label")]).toEqual([false, null, "Show Redesign ui lead's agents"]);
  cleanup();
  // The same window, another thread on screen: the person never opened the parent, so it is closed.
  const other = await sidebar({}, "thr_release");
  await other.slot.findByTestId("oats-tree");
  expect([toggles(other.slot)[0]!.getAttribute("aria-expanded"), rowOn(other.slot, "thr_mockups"), (toggles(other.slot)[0] as HTMLButtonElement).disabled]).toEqual(["false", null, false]);
});

test("what the person opened is kept while the window lives (the sidebar drawn anew), and not after the page loads again; a roster with no parent has no chevron and no gutter", async () => {
  const first = await sidebar();
  await first.slot.findByTestId("oats-tree");
  fireEvent.click(toggles(first.slot)[0]!);
  cleanup(); // bb's drawer closes: the sidebar is gone, the window is not
  const again = await sidebar();
  await again.slot.findByTestId("oats-tree");
  expect([toggles(again.slot)[0]!.getAttribute("aria-expanded"), rowOn(again.slot, "thr_mockups") !== null]).toEqual(["true", true]);
  cleanup();
  resetApp(); // the page loads again
  const loaded = await sidebar();
  await loaded.slot.findByTestId("oats-tree");
  expect([toggles(loaded.slot)[0]!.getAttribute("aria-expanded"), rowOn(loaded.slot, "thr_mockups")]).toEqual(["false", null]);
  // Nothing of it is stored: no setting written, no storage.
  expect([window.localStorage.length, window.sessionStorage.length]).toEqual([0, 0]);
  cleanup();
  resetApp();
  const flat = await sidebar({ snapshot: () => fixtureSnapshot(fixtureAgents().map((agent) => ({ ...agent, parent: null }))) });
  await flat.slot.findByTestId("oats-tree");
  expect(toggles(flat.slot)).toHaveLength(0);
  expect(flat.slot.getAllByTestId("oats-agent-row")).toHaveLength(7);
  for (const row of flat.slot.getAllByTestId("oats-agent-row")) expect(row.className.split(/\s+/)).toContain("pl-2");
});

test("a click on a row records navigate.toThread(id) and calls onNavigate", async () => {
  const { slot, navigated } = await sidebar();
  await openParents(slot);
  const rows = await slot.findAllByTestId("oats-agent-row");
  fireEvent.click(rows.find((row) => row.getAttribute("data-sidebar-thread-id") === "thr_mockups")!);
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "thr_mockups" }]);
  expect(navigated()).toBe(1);
});

test("a modified click is left to the anchor: nothing is navigated by the plugin", async () => {
  const { slot, navigated } = await sidebar();
  const rows = await slot.findAllByTestId("oats-agent-row");
  // jsdom cannot follow a link: note whether the plugin left the click alone, then stop it
  const leftAlone: boolean[] = [];
  slot.container.addEventListener("click", (event) => {
    leftAlone.push(!event.defaultPrevented);
    event.preventDefault();
  });
  fireEvent.click(rows[0]!, { ctrlKey: true });
  fireEvent.click(rows[0]!, { metaKey: true });
  expect(leftAlone).toEqual([true, true]);
  expect(slot.inspection.navigateCalls).toEqual([]);
  expect(navigated()).toBe(0);
});

test('"Other threads" lists the thread that is no OATS agent, and it opens like any other', async () => {
  const { slot, navigated } = await sidebar();
  await slot.findByTestId("oats-tree");
  const others = slot.getAllByTestId("oats-other-row");
  expect(ids(others)).toEqual(["thr_plain"]);
  expect(others[0]!.getAttribute("data-sidebar-thread-shortcut-target")).toBe("");
  expect(slot.getByText("Other threads")).toBeTruthy();
  fireEvent.click(others[0]!);
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "thr_plain" }]);
  expect(navigated()).toBe(1);
});

test("the workspace's name, with no heading under it; at the roster's foot New agent, and no line that counts who waits (the marked rows and bb's badge say it); then the pages under their heading", async () => {
  const { slot, navigated } = await sidebar();
  expect((await slot.findByTestId("oats-workspace-line")).textContent).toBe("oats");
  // No heading names the layout: the workspace's name heads the roster.
  expect(Array.from(slot.getByTestId("oats-sidebar").querySelectorAll("h2")).map((heading) => heading.textContent)).toEqual(["Workspace", "Other threads"]);
  // No foot line: who waits is said by the rows' own marks (three here), and counted by bb's badge (test/home/home.test.tsx).
  expect(slot.queryByTestId("oats-needs-line")).toBeNull();
  expect(slot.getByTestId("oats-sidebar").textContent).not.toMatch(/need you/);
  expect(Array.from(slot.getByTestId("oats-tree").querySelectorAll('[data-mark][data-state="needs-you"]')).length).toBe(3);
  // The order a person reads: the agents, the act that makes one, then the workspace's pages.
  const order = ["oats-tree", "oats-new-agent", "oats-pages"].map((id) => slot.getByTestId(id));
  for (let i = 1; i < order.length; i += 1) expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(slot.getByTestId("oats-new-agent").tagName).toBe("BUTTON");
  expect(slot.getByTestId("oats-new-agent").textContent).toBe("New agent");
  fireEvent.click(slot.getByTestId("oats-new-agent"));
  expect(slot.inspection.navigateCalls).toEqual([
    { method: "toPluginPanel", path: "new-agent" }, // the form's own page (app/spawn)
  ]);
  expect(navigated()).toBe(1);
});

test("the four page rows call toPluginPanel, then onNavigate", async () => {
  const { slot, navigated } = await sidebar();
  await slot.findByTestId("oats-workspace-line");
  for (const path of ["souls", "capabilities", "teams", "machines"]) fireEvent.click(slot.getByTestId(`oats-page-link-${path}`));
  expect(slot.inspection.navigateCalls).toEqual([
    { method: "toPluginPanel", path: "souls" },
    { method: "toPluginPanel", path: "capabilities" },
    { method: "toPluginPanel", path: "teams" },
    { method: "toPluginPanel", path: "machines" },
  ]);
  expect(navigated()).toBe(4);
});

test("the active thread's row is marked", async () => {
  const { slot } = await sidebar({}, "thr_ci");
  const rows = await slot.findAllByTestId("oats-agent-row");
  expect(rows.filter((row) => row.getAttribute("aria-current") === "page").map((row) => row.getAttribute("data-sidebar-thread-id"))).toEqual(["thr_ci"]);
});

test("while no snapshot has loaded: one line, and every thread is listed", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const { slot } = await sidebar({ snapshot: async () => (await held, handlers().snapshot(null)) });
  expect(slot.getByRole("status").textContent).toBe("Reading…");
  expect(ids(slot.getAllByTestId("oats-other-row"))).toEqual(fixtureThreads().map((thread) => thread.id));
  expect(slot.queryByText("Other threads")).toBeNull();
  expect(slot.getByTestId("oats-sidebar").querySelector("h2")).toBeNull(); // bb's threads as bb has them, under no heading
  expect(slot.queryByTestId("oats-workspace-line")).toBeNull();
  release();
  await slot.findByTestId("oats-tree");
});

test("with a failed snapshot: every thread is listed, the notice says why in its title, what to do and the error are under Details, and Retry rereads", async () => {
  let failing = true;
  const { slot, navigated } = await sidebar({
    snapshot: () =>
      failing
        ? { ok: false, at: "2026-11-19T12:30:00.000Z", code: "NO_DEPLOYMENT", message: "No OATS deployment found.\nSet one in the plugin's settings." }
        : handlers().snapshot(null),
  });
  // A titled notice in a person's words, with Retry and the way to the settings. Its one fold,
  // closed, holds what to do in a sentence, then the code and the raw message: nothing else is drawn.
  const notice = await slot.findByRole("alert");
  expect(notice.querySelector("h3")!.textContent).toBe("No OATS deployment found on this machine");
  expect(slot.getByRole("link", { name: "Open settings" }).getAttribute("href")).toBe("/settings/plugins/test-plugin");
  expect(notice.textContent).toBe(`No OATS deployment found on this machine▸Details${slot.getByTestId("oats-notice-details").querySelector("div")!.textContent}RetryOpen settings`);
  expect((slot.getByTestId("oats-notice-details") as HTMLDetailsElement).open).toBe(false);
  expect(Array.from(slot.getByTestId("oats-notice-details").querySelectorAll("p")).map((line) => line.textContent)).toEqual([
    "Open a bb project inside the deployment, or set its directory in the plugin's settings.",
    "NO_DEPLOYMENT: No OATS deployment found.",
    "Set one in the plugin's settings.",
  ]);
  expect(ids(slot.getAllByTestId("oats-other-row"))).toEqual(fixtureThreads().map((thread) => thread.id));
  expect(slot.queryByTestId("oats-tree")).toBeNull();

  // bb stays usable: a thread opens
  fireEvent.click(slot.getAllByTestId("oats-other-row")[0]!);
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "thr_release" }]);
  expect(navigated()).toBe(1);

  failing = false;
  fireEvent.click(slot.getByRole("button", { name: "Retry" }));
  await slot.findByTestId("oats-tree");
  expect(rosterCalls(slot)).toEqual(["snapshot", "refresh", "snapshot"]);
});

test("when the plugin's server does not answer at all, the threads are listed with the error and Retry", async () => {
  const { slot } = await sidebar({
    snapshot: () => {
      throw new Error("plugin oats is not running");
    },
  });
  // In a person's words, with the plugin's own message under Details: nothing here is the kernel's word.
  const notice = await slot.findByRole("alert");
  expect(notice.querySelector("h3")!.textContent).toBe("OATS could not be read");
  expect(slot.getByTestId("oats-notice-details").textContent).toContain("plugin oats is not running");
  expect(slot.getAllByTestId("oats-other-row")).toHaveLength(8);
  expect(slot.getByRole("button", { name: "Retry" })).toBeTruthy();
});

test("an oats/changed event rereads the snapshot once, and the tree follows", async () => {
  let agents = fixtureAgents();
  const { slot } = await sidebar({ snapshot: () => fixtureSnapshot(agents) });
  await slot.findByTestId("oats-tree");
  agents = agents.filter((agent) => agent.instance !== "weekly-digest-helper");
  await slot.behavior.emitRealtime("oats/changed", { at: "2026-11-19T12:40:00.000Z" });
  await waitFor(() => expect(ids(slot.getAllByTestId("oats-other-row"))).toEqual(["thr_digest", "thr_plain"]));
  // the souls are read once, for their names: a status change does not reread them
  expect(rosterCalls(slot)).toEqual(["snapshot", "snapshot"]);
  expect(slot.inspection.rpcCalls.filter((call) => call.method === "souls")).toHaveLength(1);
});

test("a title with markup is drawn as text", async () => {
  const threads = fixtureThreads().map((thread) =>
    thread.id === "thr_plain" ? { ...thread, title: "<img src=x onerror=alert(1)>", displayTitle: "<img src=x onerror=alert(1)>" } : thread,
  );
  const app = await loadApp();
  const slot = renderSlot<PluginThreadListProps, Contract>(
    app.threadLists[0]!,
    { activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate: () => {}, searchQuery: "" },
    { rpc: handlers(), sidebarThreads: { status: "ready", threads } },
  );
  const other = await slot.findByTestId("oats-other-row");
  expect(other.textContent).toContain("<img src=x onerror=alert(1)>");
  expect(other.querySelector("img")).toBeNull();
});

test("a row's soul is the matching soul's key once the souls are read, else the roster's name", async () => {
  const { slot } = await sidebar({
    souls: () => ({
      souls: [{ name: "oats.okf/knowledge-harvester", agent: "knowledge-harvester", description: "", origin: "oats.okf 2.1.0", capabilities: [], spawnable: true, problem: null }],
    }),
  });
  await openParents(slot);
  const rows = await slot.findAllByTestId("oats-agent-row");
  const row = (id: string) => rows.find((candidate) => candidate.getAttribute("data-sidebar-thread-id") === id)!;
  await waitFor(() => expect(row("thr_harvest").textContent).toContain("oats.okf/knowledge-harvester"));
  expect(row("thr_release").textContent).toContain("oats-maintainer");
});

test("several machines and none chosen: the notice says so and links to the plugin's settings; Retry would not help", async () => {
  const { slot } = await sidebar({
    snapshot: () => ({ ok: false, at: "t", code: "CHOOSE_HOST", message: "This bb server has 2 machines: choose the one that holds the OATS homes." }),
  });
  const link = await slot.findByRole("link", { name: "Open settings" });
  expect(link.getAttribute("href")).toBe("/settings/plugins/test-plugin");
  expect(slot.getByRole("alert").querySelector("h3")!.textContent).toBe("Choose the machine that holds your agents");
  expect(slot.queryByRole("button", { name: "Retry" })).toBeNull();
});

test("a kernel refusal of oats status: what happened in words; the kernel's code and message one press away, under Details", async () => {
  const { slot } = await sidebar({
    snapshot: () => ({ ok: false, at: "t", code: "E_WORKSPACE_INVALID", message: "oats-workspace.yaml: unknown key `foo`\nsee docs/workspace.md" }),
  });
  const notice = await slot.findByRole("alert");
  expect(notice.querySelector("h3")!.textContent).toBe("OATS could not read this deployment");
  expect(slot.getByTestId("oats-unreadable").getAttribute("data-code")).toBe("E_WORKSPACE_INVALID");
  // The kernel's words are not on the notice's face: its code leads its message under the one fold, once.
  expect((slot.getByTestId("oats-notice-details") as HTMLDetailsElement).open).toBe(false);
  expect(Array.from(slot.getByTestId("oats-notice-details").querySelectorAll("p")).map((line) => line.textContent)).toEqual(["E_WORKSPACE_INVALID: oats-workspace.yaml: unknown key `foo`", "see docs/workspace.md"]);
  expect(notice.textContent).toBe("OATS could not read this deployment▸DetailsE_WORKSPACE_INVALID: oats-workspace.yaml: unknown key `foo`see docs/workspace.mdRetry");
});

test("while bb is still listing its threads nothing is joined: no agent is said to be missing or quiet", async () => {
  const app = await loadApp();
  const slot = renderSlot<PluginThreadListProps, Contract>(
    app.threadLists[0]!,
    { activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate: () => {}, searchQuery: "" },
    { rpc: handlers(), sidebarThreads: { status: "loading", threads: [] } },
  );
  await waitFor(() => expect(slot.inspection.rpcCalls.map((call) => call.method)).toContain("snapshot"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(slot.getByRole("status").textContent).toBe("Reading…");
  expect(slot.queryByTestId("oats-needs-line")).toBeNull();
  expect(slot.queryByText("No OATS agents run in bb yet.")).toBeNull();
});

test("when bb cannot list its threads the line says so, with Retry", async () => {
  const app = await loadApp();
  const slot = renderSlot<PluginThreadListProps, Contract>(
    app.threadLists[0]!,
    { activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate: () => {}, searchQuery: "" },
    { rpc: handlers(), sidebarThreads: { status: "error", threads: [] } },
  );
  const notice = await slot.findByRole("alert");
  expect(notice.querySelector("h3")!.textContent).toBe("bb could not list its threads");
  expect(notice.textContent).toContain("So the OATS agents cannot be matched to them.");
  expect(slot.getByRole("button", { name: "Retry" })).toBeTruthy();
  expect(slot.queryByTestId("oats-tree")).toBeNull();
});

test("a feature's own page is a row under the four pages, with its mark while its hook gives one", async () => {
  let failed = true;
  const remove = addPageLink({ path: "example", title: "Example", useMark: () => (failed ? { label: "Example, a run failed" } : null) });
  try {
    const { slot } = await sidebar();
    const row = await slot.findByTestId("oats-page-link-example");
    // The four pages first, then what the features added, this one last.
    const rows = Array.from(slot.container.querySelectorAll('[data-testid^="oats-page-link-"]')).map((link) => link.textContent);
    expect(rows.slice(0, 4)).toEqual(["Souls", "Capabilities", "Teams", "Machines"]);
    expect(rows.at(-1)).toBe("Example");
    const mark = row.querySelector('[data-testid="oats-mark"]')!;
    expect([mark.getAttribute("role"), mark.getAttribute("aria-label")]).toEqual(["img", "Example, a run failed"]);
    // The four pages have no mark.
    expect(slot.getByTestId("oats-page-link-souls").querySelector('[data-testid="oats-mark"]')).toBeNull();
    fireEvent.click(row);
    expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "example" }]);
    slot.unmount();
    failed = false;
    const calm = (await sidebar()).slot;
    expect((await calm.findByTestId("oats-page-link-example")).querySelector('[data-testid="oats-mark"]')).toBeNull();
    calm.unmount();
  } finally {
    remove();
  }
  // Taken away: the block is the four pages again.
  const { slot } = await sidebar();
  await slot.findByTestId("oats-page-link-souls");
  expect(slot.queryByTestId("oats-page-link-example")).toBeNull();
});

test("while OATS cannot be read after it was, the tree stays as last read under the one notice: its age said once, that the acts are off, Retry; never bb's flat list", async () => {
  const last = { at: new Date(Date.now() - 2 * 60_000 - 5_000).toISOString(), deployment: { root: "/abs/deployment", workspace: "oats", machine: "falcon" }, agents: fixtureAgents() };
  const { slot } = await sidebar({ snapshot: () => ({ ok: false, at: new Date().toISOString(), code: "OATS_TIMEOUT", message: "`oats` did not answer within 20 s and was stopped", last }) });
  await openParents(slot);
  const rows = await slot.findAllByTestId("oats-agent-row");
  expect(rows).toHaveLength(7); // the same seven agents, joined to their threads
  expect(slot.getAllByTestId("oats-agent-row-threadless")).toHaveLength(1); // and the one that runs in tmux
  const notice = slot.getByRole("alert");
  expect(notice.querySelector("h3")!.textContent).toBe("OATS did not answer on falcon");
  // The notice's face: its title, the age said once and in one form, that the acts are off, its one fold and Retry.
  expect(notice.textContent).toBe(`OATS did not answer on falconRead 2 min ago. Acts are off.▸Details${slot.getByTestId("oats-notice-details").querySelector("div")!.textContent}Retry`);
  expect(slot.getByTestId("oats-sidebar").textContent!.match(/2 min ago/g)).toHaveLength(1);
  expect(slot.queryByTestId("oats-last-observation")).toBeNull();
  expect(slot.getByTestId("oats-held").textContent).toBe("Acts are off.");
  expect(Array.from(slot.getByTestId("oats-notice-details").querySelectorAll("p")).map((line) => line.textContent)).toEqual(["It took more than 20 s.", "OATS_TIMEOUT: `oats` did not answer within 20 s and was stopped"]);
  // "New agent" is held with the acts: in its place, off, and it opens nothing. No reason stands
  // beside it or in a title: the notice over the roster, on the same screen, says why, with Retry.
  const newAgent = slot.getByTestId("oats-new-agent") as HTMLButtonElement;
  expect([newAgent.disabled, newAgent.title, newAgent.getAttribute("aria-describedby")]).toEqual([true, "", null]);
  expect(slot.queryByTestId("oats-new-agent-held")).toBeNull();
  expect(slot.getByTestId("oats-sidebar").textContent).not.toContain("Comes back when OATS is read again");
  expect(notice.compareDocumentPosition(newAgent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(newAgent);
  expect(slot.inspection.navigateCalls).toEqual([]);
  expect(slot.queryByTestId("oats-needs-line")).toBeNull();
  expect(Array.from(slot.getByTestId("oats-tree").querySelectorAll('[data-mark][data-state="needs-you"]')).length).toBe(3); // the rows as last read keep their marks
  expect(slot.getByRole("button", { name: "Retry" })).toBeTruthy();
});

test("an agent the kernel refused as one it does not know says so in its row, until the next roster is read", async () => {
  let at = "2026-11-19T12:30:00.000Z";
  const { slot } = await sidebar({ snapshot: () => ({ ...fixtureSnapshot(), at }) });
  const facts = () => within(slot.getAllByTestId("oats-agent-row").find((row) => row.getAttribute("data-sidebar-thread-id") === "thr_release")!).getByTestId("oats-row-facts").textContent;
  await slot.findByTestId("oats-tree");
  expect(facts()).toBe("Needs you · oats-maintainer");
  const { markGone } = await import("../../app/roster/gone");
  act(() => markGone("release-070-maintainer"));
  expect(facts()).toBe("Not in OATS any more · oats-maintainer");
  // The next roster: the kernel lists it after all, and the row says what the kernel says.
  at = "2026-11-19T12:31:00.000Z";
  await slot.behavior.emitRealtime("oats/changed", { at });
  await waitFor(() => expect(facts()).toBe("Needs you · oats-maintainer"));
});

test("the row of the plugin's page that is shown is the selected one (D-037), and none is while a thread is shown", async () => {
  const { slot } = await sidebar();
  await slot.findByTestId("oats-workspace-line");
  const current = () => ["souls", "capabilities", "teams", "machines"].filter((path) => slot.getByTestId(`oats-page-link-${path}`).getAttribute("aria-current") === "page");
  expect(current()).toEqual([]);
  const { shownPage } = await import("../../app/workspace/pages");
  const Teams = shownPage("teams", () => null);
  const page = renderSlot<object, Contract>({ component: Teams } as never, {}, { rpc: handlers(), sidebarThreads: sidebarThreads() });
  await waitFor(() => expect(current()).toEqual(["teams"]));
  expect(slot.getByTestId("oats-page-link-teams").className).toContain("bg-accent");
  page.unmount();
  await waitFor(() => expect(current()).toEqual([]));
});

// One rule for a state (model/view.ts `state`), read by the sidebar's row and by the agent's panel:
// a tmux agent that is stopped, as the kernel prints it (`{ running: false }`, no runtimeState;
// awebai/oats lib/instance-listing.mjs at 95c7b43b3), says "Stopped" in both, rendered together.
test("a stopped tmux agent says Stopped in its sidebar row and in its own panel", async () => {
  const agents = fixtureAgents().map((agent) => (agent.backend === "tmux" ? { ...agent, running: false, runtimeState: null } : agent));
  const app = await loadApp();
  const List = app.threadLists[0]!.component;
  const { InstancePanel } = await import("../../app/panel");
  const slot = renderSlot<PluginThreadListProps, Contract>(
    {
      component: (props: PluginThreadListProps) => (
        <>
          <List {...props} />
          <InstancePanel instance="kernel-fix-developer" />
        </>
      ),
    } as never,
    { activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate: () => undefined, searchQuery: "" },
    { rpc: handlers({ snapshot: () => fixtureSnapshot(agents) }), sidebarThreads: sidebarThreads() },
  );
  const row = (await slot.findAllByTestId("oats-agent-row-threadless")).find((candidate) => candidate.getAttribute("data-instance") === "kernel-fix-developer")!;
  expect(within(row).getByTestId("oats-row-facts").textContent).toBe("Stopped · oats-developer · tmux");
  expect(row.querySelector("[data-mark]")!.getAttribute("data-state")).toBe("stopped");
  const header = await slot.findByTestId("oats-panel-state");
  expect(header.querySelector("[data-state]")!.getAttribute("data-state")).toBe("stopped");
  expect(header.textContent).toContain("Stopped");
});

// The plugin's setting `pages`: a release shows only the pages that are finished (its default: the
// home alone). A page that is not shown has no link in the sidebar and no mark; the count of who
// waits still opens the home; "New agent" stays, whatever pages are shown: the form is a page of its
// own (app/spawn), not one a release leaves out.
test("with the release's default (pages: home) the sidebar has the roster, New agent and no page link; with every page, all of them", async () => {
  const withPages = async (pages: string) => {
    const app = await loadApp();
    return renderSlot<PluginThreadListProps, Contract>(
      app.threadLists[0]!,
      { activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate: () => undefined, searchQuery: "" },
      { rpc: handlers(), sidebarThreads: sidebarThreads(), settings: { pages } },
    );
  };
  const pilot = await withPages("home");
  await pilot.findByTestId("oats-tree");
  expect(pilot.queryByTestId("oats-pages")).toBeNull();
  for (const path of ["souls", "capabilities", "teams", "machines", "automations"]) expect(pilot.queryByTestId(`oats-page-link-${path}`)).toBeNull();
  expect(pilot.getByTestId("oats-new-agent").textContent).toBe("New agent"); // the way to start an agent survives the hidden pages
  // (The home is reached from bb's own entry for the plugin, which carries the badge: the sidebar has no line that opens it.)
  expect(pilot.queryByTestId("oats-needs-line")).toBeNull();
  fireEvent.click(pilot.getByTestId("oats-new-agent"));
  expect(pilot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "new-agent" }]);
  pilot.unmount();
  resetApp();
  const all = await withPages(ALL_PAGES);
  await all.findByTestId("oats-tree");
  for (const path of ["souls", "capabilities", "teams", "machines", "automations"]) expect(all.getByTestId(`oats-page-link-${path}`)).toBeTruthy();
  expect(all.getByTestId("oats-new-agent")).toBeTruthy();
  all.unmount();
  resetApp();
  // With the home itself left out: no count either.
  const none = await withPages("souls");
  await none.findByTestId("oats-tree");
  expect(none.queryByTestId("oats-needs-line")).toBeNull();
  expect(none.getByTestId("oats-page-link-souls")).toBeTruthy();
});

test("the path of a page that is not shown answers one line and the way back; the page itself is not drawn", async () => {
  const { shownPage } = await import("../../app/workspace/pages");
  const Teams = shownPage("teams", () => <p data-testid="the-page">teams</p>);
  const hidden = renderSlot<object, Contract>({ component: Teams } as never, {}, { rpc: handlers(), sidebarThreads: sidebarThreads(), settings: { pages: "home" } });
  expect(hidden.getByTestId("oats-page-not-shown").textContent).toBe("This page is not shown in this release of the OATS plugin.Back to Home");
  expect(hidden.queryByTestId("the-page")).toBeNull();
  fireEvent.click(hidden.getByTestId("oats-page-not-shown-back"));
  expect(hidden.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "home" }]);
  hidden.unmount();
  const shown_ = renderSlot<object, Contract>({ component: Teams } as never, {}, { rpc: handlers(), sidebarThreads: sidebarThreads(), settings: { pages: "home, Teams" } });
  expect(shown_.getByTestId("the-page")).toBeTruthy();
});

test("until a feature names the form's page, \"New agent\" opens the Souls page where that is shown, and is absent where it is not", async () => {
  const { setNewAgent } = await import("../../app/workspace/pages");
  const { openNewAgent } = await import("../../app/spawn");
  const app = await loadApp();
  const withPages = (pages: string) =>
    renderSlot<PluginThreadListProps, Contract>(
      app.threadLists[0]!,
      { activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate: () => undefined, searchQuery: "" },
      { rpc: handlers(), sidebarThreads: sidebarThreads(), settings: { pages } },
    );
  setNewAgent(null);
  try {
    const pilot = withPages("home");
    await pilot.findByTestId("oats-tree");
    expect(pilot.queryByTestId("oats-new-agent")).toBeNull();
    pilot.unmount();
    resetApp();
    const souls = withPages("home, souls");
    fireEvent.click(await souls.findByTestId("oats-new-agent"));
    expect(souls.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "souls" }]);
  } finally {
    setNewAgent(openNewAgent); // as the spawn feature's register left it
  }
});

// One count of who waits (model/view.ts `needing`), read by the sidebar's foot (the home follows in its owner's change):
// an agent with no bb thread that waits on a person is counted, as its own row says it does.
test("every agent that waits is marked on its row, the ones with no bb thread included; no foot line counts them", async () => {
  const claim = { reason: "question", message: "Which branch?", since: "2026-11-19T12:00:00.000Z" };
  // The tmux agent runs and carries a claim; the stopped agent's thread is gone (it shows none).
  const agents = fixtureAgents().map((agent) => (agent.backend === "tmux" ? { ...agent, running: true, runtimeState: null, waiting: claim } : agent));
  const { slot } = await sidebar({ snapshot: () => fixtureSnapshot(agents) }, null, { status: "ready", threads: fixtureThreads().filter((thread) => thread.id !== "thr_digest") });
  await slot.findByTestId("oats-tree");
  expect(slot.queryByTestId("oats-needs-line")).toBeNull();
  expect(Array.from(slot.getByTestId("oats-tree").querySelectorAll('[data-mark][data-state="needs-you"]')).length).toBe(4); // three in the tree, and the one on tmux
  const tmux = slot.getAllByTestId("oats-agent-row-threadless").find((row) => row.getAttribute("data-instance") === "kernel-fix-developer")!;
  expect(within(tmux).getByTestId("oats-row-facts").textContent).toBe("Needs you · oats-developer · tmux");
});

// Nobody waits: no row is marked, and no line says so. "Nothing needs you." is the home's empty
// state, said there once (Joan's direction of 23 Nov 2026).
test("with nobody waiting the roster says nothing of it: no needs line, no marked row, and New agent stays", async () => {
  const agents = fixtureAgents().map((agent) => ({ ...agent, waiting: null }));
  const threads = fixtureThreads().map((thread) => ({ ...thread, hasPendingInteraction: false }));
  const { slot } = await sidebar({ snapshot: () => fixtureSnapshot(agents) }, null, { status: "ready", threads });
  await slot.findByTestId("oats-tree");
  expect(slot.queryByTestId("oats-needs-line")).toBeNull();
  expect(slot.getByTestId("oats-sidebar").textContent).not.toMatch(/need you|needs you/i);
  expect(slot.getByTestId("oats-new-agent").textContent).toBe("New agent");
});

// On a deployment that shows more than the default, a page opened by its path must not say "not
// shown" for the moment bb takes to read the settings (round 1 of the second pass).
test("while bb is still reading the settings no page is known to be shown or hidden; settings bb cannot give are the default's", async () => {
  const { pagesOf, showEveryPageWhenUnset } = await import("../../app/workspace/pages");
  showEveryPageWhenUnset(false); // as in the built app
  try {
    const loading = pagesOf({ values: undefined, isLoading: true });
    expect([loading.known, loading.has("home"), loading.has("souls")]).toEqual([false, false, false]);
    const unavailable = pagesOf({ values: undefined, isLoading: false });
    expect([unavailable.known, unavailable.has("home"), unavailable.has("souls")]).toEqual([true, true, false]);
    const read = pagesOf({ values: { pages: "home, Souls" }, isLoading: false });
    expect([read.known, read.has("home"), read.has("souls"), read.has("teams")]).toEqual([true, true, true, false]);
    // A cleared field is the default, as for the plugin's other settings.
    const cleared = pagesOf({ values: { pages: " " }, isLoading: false });
    expect([cleared.has("home"), cleared.has("souls")]).toEqual([true, false]);
    // The values of a read before stay while bb reads them again.
    expect(pagesOf({ values: { pages: "souls" }, isLoading: true }).known).toBe(true);
  } finally {
    showEveryPageWhenUnset(true);
  }
});

// One full notice on a screen (the home read's ruling): beside a page that shows the notice over
// what it keeps, the sidebar says one line, how old the roster is and Retry; alone, it is the notice.
test("on the last roster read, beside a page that shows the full notice the sidebar says one line: \"Read <age>.\" and Retry", async () => {
  const last = { at: new Date(Date.now() - 2 * 60_000 - 5_000).toISOString(), deployment: { root: "/abs/deployment", workspace: "oats", machine: "falcon" }, agents: fixtureAgents() };
  const failed = { snapshot: () => ({ ok: false as const, at: new Date().toISOString(), code: "OATS_TIMEOUT", message: "`oats` did not answer within 20 s and was stopped", machine: "falcon", last }) };
  const { slot } = await sidebar(failed);
  await openParents(slot);
  await slot.findAllByTestId("oats-agent-row");
  expect(slot.getByTestId("oats-held")).toBeTruthy(); // alone: the full notice
  expect(slot.queryByTestId("oats-last-observation")).toBeNull();
  // A page of the plugin is drawn beside it, with the notice above what it keeps.
  const app = await loadApp();
  const panel = app.navPanels.find((candidate) => candidate.id === "teams")!;
  const page = renderSlot<{ subPath: string }, Contract>(panel, { subPath: "" }, { rpc: handlers(failed), sidebarThreads: sidebarThreads() });
  await waitFor(() => expect(within(page.container).getByTestId("oats-held")).toBeTruthy());
  const line = await waitFor(() => within(slot.container).getByTestId("oats-last-observation"));
  expect(line.textContent).toBe("Read 2 min ago.Retry");
  expect(within(slot.container).queryByTestId("oats-held")).toBeNull();
  expect(within(slot.container).queryByRole("alert")).toBeNull();
  // With the sidebar's notice down to one line, New agent stays off and still says no reason of its
  // own, in words or in a title: the page's full notice beside it says why, with "Acts are off.".
  const heldNew = within(slot.container).getByTestId("oats-new-agent") as HTMLButtonElement;
  expect([heldNew.disabled, heldNew.title, heldNew.getAttribute("aria-describedby")]).toEqual([true, "", null]);
  expect(within(slot.container).queryByTestId("oats-new-agent-held")).toBeNull();
  expect(slot.container.textContent).not.toContain("Comes back when OATS is read again");
  expect(within(page.container).getByTestId("oats-held").textContent).toBe("Acts are off.");
  expect(within(slot.container).getAllByTestId("oats-agent-row")).toHaveLength(7); // the roster stays
  fireEvent.click(within(line).getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(slot.inspection.rpcCalls.some((call) => call.method === "refresh")).toBe(true));
  // The page leaves: the sidebar is the one place again, and says it whole.
  page.unmount();
  await waitFor(() => expect(within(slot.container).getByTestId("oats-held")).toBeTruthy());
  expect(within(slot.container).queryByTestId("oats-last-observation")).toBeNull();
  expect(within(slot.container).queryByTestId("oats-new-agent-held")).toBeNull();
});

// The whole name is one hover away on every row: a name cut after its second line is still there.
test("every roster row's name carries the whole instance name as its title, a bb-thread agent's too", async () => {
  const { slot } = await sidebar();
  const rows = await slot.findAllByTestId("oats-agent-row");
  const titles = rows.map((row) => within(row).getByTestId("oats-row-name").getAttribute("title"));
  expect(titles).toContain("release-070-maintainer");
  expect(titles.every((title) => typeof title === "string" && title.length > 0)).toBe(true);
  const threadless = slot.getByTestId("oats-agent-row-threadless");
  expect(within(threadless).getByTestId("oats-row-name").getAttribute("title")).toBe("kernel-fix-developer");
});
