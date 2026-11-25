// @vitest-environment jsdom
// A8: the Sidebar (experimental_threadList) with the pinned fixtures.
import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { noteActed } from "../../app/roster/reading";
import { addPageLink } from "../../app/workspace/pages";
import { fixtureAgents, fixtureSnapshot, fixtureThreads } from "../helpers/fixtures";
import { ALL_PAGES, handlers, loadApp, resetApp, sidebarThreads } from "../helpers/render";
import type { Contract, Handlers } from "../helpers/render";

afterEach(() => {
  vi.useRealTimers();
  resetApp();
});

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
    // The row's one order: the state, then the soul (a reason and where it is come after: test/app/row-facts.test.tsx).
    expect(Array.from(line.querySelectorAll("[data-phrase]")).map((part) => part.getAttribute("data-phrase")).slice(0, 2)).toEqual(["state", "soul"]);
    // With no reason on the line the soul is the part that gives way, with "…"; the state never shrinks.
    expect(line.querySelector('[data-phrase="soul"]')!.className.split(/\s+/)).toEqual(expect.arrayContaining(["shrink", "truncate", "min-w-[1.5em]"]));
    expect(line.querySelector('[data-phrase="state"]')!.className.split(/\s+/)).toContain("shrink-0");
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
    ["kernel-fix-developer", "Running · oats-developer · tmux"], // on tmux: "Running" (the kernel says that it runs, nothing of a turn)
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
  expect(chevron.textContent).toBe("▸"); // closed: the mark that points right, and nothing else: no number
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
  expect(toggles(slot)[0]!.textContent).toBe("▾"); // open: the mark that points down
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

test("a closed parent whose subtree holds a row that needs a person carries that row's mark ON ITS CHEVRON (the lead's T1), never on its line, which says only the parent; open, or over quiet children, it carries none", async () => {
  const claim = { reason: "attention" as const, message: "Which mockup?", since: "2026-11-19T12:00:00.000Z" };
  const agents = fixtureAgents().map((agent) => (agent.instance === "desktop-mockups-developer" ? { ...agent, waiting: claim } : agent));
  const { slot } = await sidebar({ snapshot: () => fixtureSnapshot(agents) });
  await slot.findByTestId("oats-tree");
  const lead = rowOn(slot, LEAD)!;
  // Its own state, mark and word, unchanged: it works. The hidden row's mark is the chevron's: its colour, and its name for a screen reader and a pointer.
  expect(within(lead).getByTestId("oats-row-facts").querySelector('[data-phrase="state"]')!.textContent).toBe("Working");
  expect(lead.querySelector("[data-mark]")!.getAttribute("data-state")).toBe("working");
  const chevron = () => toggles(slot)[0]!;
  const mark = () => chevron().querySelector<HTMLElement>('[data-testid="oats-row-toggle-mark"]')!;
  expect([mark().getAttribute("data-inside"), chevron().getAttribute("aria-label"), chevron().getAttribute("title")]).toEqual(["needs-you", "Show Redesign ui lead's agents: 1 needs you", "Show Redesign ui lead's agents: 1 needs you"]);
  // THE CHEVRON NEVER LEAVES (the lead's ruling after its reader's second look): it is what says the row opens. The
  // hidden row's own mark, the needs-you disc, stands BESIDE it, after it, INSIDE THE SAME BUTTON (pressing either
  // opens the row), before the parent's own dot: found without colour. The chevron itself has no colour here.
  const disc = () => chevron().querySelector("[data-mark]");
  expect(mark().textContent).toBe("▸");
  expect([disc()!.getAttribute("data-state"), disc()!.textContent, disc()!.getAttribute("aria-hidden")]).toEqual(["needs-you", "!", "true"]);
  expect(Array.from(chevron().children).map((child) => child.getAttribute("data-testid"))).toEqual(["oats-row-toggle-mark", "oats-row-toggle-inside"]); // the chevron, then the mark
  // The gutter (24 px) holds both, from its start: the chevron in a box as wide as its glyph (8 px), the mark's box
  // (12 px); the 4 px left stand AFTER the mark, between it and the parent's own dot: never flush against it.
  expect([chevron().className.split(/\s+/).includes("justify-start"), mark().className.split(/\s+/).includes("w-2"), chevron().querySelector('[data-testid="oats-row-toggle-inside"]')!.className.split(/\s+/).includes("w-3")]).toEqual([true, true, true]);
  expect(mark().className).not.toMatch(/text-(warning|destructive|success)/);
  // The parent's line says only the parent: no mark after its state's word.
  expect(within(lead).queryByTestId("oats-row-inside")).toBeNull();
  expect(within(lead).getByTestId("oats-row-facts").querySelectorAll("[data-mark]")).toHaveLength(0);
  expect(within(lead).getByTestId("oats-row-facts").textContent).toBe("Working · oats-product-expert");
  // Opened: the row itself is in sight with its own mark, and the chevron carries none.
  fireEvent.click(chevron());
  expect([mark().getAttribute("data-inside"), chevron().getAttribute("aria-label"), chevron().getAttribute("title"), disc(), mark().textContent]).toEqual([null, "Hide Redesign ui lead's agents", null, null, "▾"]);
  expect(rowOn(slot, "thr_mockups")!.querySelector("[data-mark]")!.getAttribute("data-state")).toBe("needs-you");
  cleanup();
  resetApp();
  // Quiet children (the sample's: one works, one is idle): no mark on the closed parent.
  const quiet = await sidebar();
  await quiet.slot.findByTestId("oats-tree");
  expect([toggles(quiet.slot)[0]!.querySelector('[data-testid="oats-row-toggle-mark"]')!.getAttribute("data-inside"), toggles(quiet.slot)[0]!.getAttribute("aria-label")]).toEqual([null, "Show Redesign ui lead's agents"]);
});

// The lead's ruling, the other cases. A hidden row that FAILED or CANNOT BE REACHED, with nobody asked: NO second dot
// (two dots side by side read as one more state of the parent, told apart by colour alone): the chevron itself takes
// the tone, and the name says the row's state. A hidden row that runs OUTSIDE OATS needs a person (the home lists it
// under "Needs you"): its own mark beside the chevron, counted. Two that ask: "2 need you". Pressing the disc opens the row.
test.each([
  ["failed", { runtimeState: "shell" }, { inside: "error", tone: /text-destructive-text/, dots: 0, name: "Show Redesign ui lead's agents: failed" }],
  ["unreachable", { running: null, runtimeState: "unreachable" }, { inside: "unreachable", tone: /text-destructive-text/, dots: 0, name: "Show Redesign ui lead's agents: unreachable" }],
  // (Runs OUTSIDE OATS: it needs a person: its own mark beside the chevron, counted; the chevron has no tone.)
  ["runs outside OATS", { sessionEnd: "stopped", outsideOats: { code: "running-outside-oats" as const, backend: "bb", message: "a harness runs in desktop-mockups-developer on bb, and OATS recorded this instance stopped" } }, { inside: "outside", tone: /^(?!.*text-(warning|destructive)).*$/, dots: 1, name: "Show Redesign ui lead's agents: 1 needs you" }],
] as const)("a closed parent over a hidden child that %s: the chevron stays; a tone and no second dot where nobody asked, the row's own mark beside it where it needs a person", async (_what, child, want) => {
  const agents = fixtureAgents().map((agent) => (agent.instance === "desktop-mockups-developer" ? { ...agent, ...child } : agent));
  const { slot } = await sidebar({ snapshot: () => fixtureSnapshot(agents) });
  await slot.findByTestId("oats-tree");
  const chevron = toggles(slot)[0]!;
  const mark = chevron.querySelector<HTMLElement>('[data-testid="oats-row-toggle-mark"]')!;
  await waitFor(() => expect(mark.getAttribute("data-inside")).toBe(want.inside));
  expect([mark.textContent, chevron.querySelectorAll("[data-mark]").length, chevron.getAttribute("aria-label"), chevron.getAttribute("title")]).toEqual(["▸", want.dots, want.name, want.name]);
  expect(mark.className).toMatch(want.tone);
  if (want.dots === 1) expect(chevron.querySelector("[data-mark]")!.getAttribute("data-state")).toBe(want.inside);
});

test("a hidden row that is GONE (the kernel no longer knows it) is neither counted nor toned by its closed parent: its state in this roster is from before it went", async () => {
  const { markGone } = await import("../../app/roster/gone");
  const claim = { reason: "attention" as const, message: "Which mockup?", since: "2026-11-19T12:00:00.000Z" };
  const agents = fixtureAgents().map((agent) => (agent.instance === "desktop-mockups-developer" ? { ...agent, waiting: claim } : agent));
  const { slot } = await sidebar({ snapshot: () => fixtureSnapshot(agents) });
  await slot.findByTestId("oats-tree");
  const chevron = () => toggles(slot)[0]!;
  await waitFor(() => expect(chevron().getAttribute("aria-label")).toBe("Show Redesign ui lead's agents: 1 needs you"));
  act(() => markGone("desktop-mockups-developer"));
  await waitFor(() => expect(chevron().getAttribute("aria-label")).toBe("Show Redesign ui lead's agents"));
  expect([chevron().querySelectorAll("[data-mark]").length, chevron().getAttribute("title")]).toEqual([0, null]);
});

test("a closed parent over TWO hidden children that ask says \"2 need you\" in its name, with one disc beside its chevron; pressing the DISC opens the row", async () => {
  const claim = { reason: "attention" as const, message: "Which one?", since: "2026-11-19T12:00:00.000Z" };
  const agents = fixtureAgents().map((agent) => (agent.parent === "redesign-ui-lead" ? { ...agent, waiting: claim } : agent));
  const { slot } = await sidebar({ snapshot: () => fixtureSnapshot(agents) });
  await slot.findByTestId("oats-tree");
  const chevron = () => toggles(slot)[0]!;
  await waitFor(() => expect(chevron().getAttribute("aria-label")).toBe("Show Redesign ui lead's agents: 2 need you"));
  expect(chevron().querySelectorAll("[data-mark]")).toHaveLength(1);
  fireEvent.click(chevron().querySelector("[data-mark]")!); // the disc is part of the one button
  expect([chevron().getAttribute("aria-expanded"), chevron().getAttribute("aria-label"), chevron().querySelectorAll("[data-mark]").length]).toEqual(["true", "Hide Redesign ui lead's agents", 0]);
});

// The mark a closed parent carries is computed from the roster on screen at every draw: nothing of it is kept from an
// earlier roster (no memo, no memory of what is inside). A mark that outlived its cause would be a false alarm on the
// one row a person trusts.
test("a closed parent's mark follows the roster: it comes when a hidden child starts to wait and GOES with the next roster in which it no longer does, while the parent stays closed", async () => {
  const claim = { reason: "attention" as const, message: "Which mockup?", since: "2026-11-19T12:00:00.000Z" };
  const waits = (on: boolean) => fixtureAgents().map((agent) => (agent.instance === "desktop-mockups-developer" ? { ...agent, waiting: on ? claim : null } : agent));
  let now = { ...fixtureSnapshot(waits(false)), at: "2026-11-19T12:30:00.000Z" };
  const { slot } = await sidebar({ snapshot: () => now });
  await slot.findByTestId("oats-tree");
  const inside = () => toggles(slot)[0]!.querySelector('[data-testid="oats-row-toggle-mark"]')!.getAttribute("data-inside");
  const closed = () => [toggles(slot)[0]!.getAttribute("aria-expanded"), rowOn(slot, "thr_mockups")];
  expect([inside(), ...closed()]).toEqual([null, "false", null]);
  // The child starts to wait: the next roster marks the closed parent.
  now = { ...fixtureSnapshot(waits(true)), at: "2026-11-19T12:30:05.000Z" };
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: now.at }));
  await waitFor(() => expect(inside()).toBe("needs-you"));
  expect(closed()).toEqual(["false", null]);
  // It no longer waits: the next roster takes the mark away, with the parent still closed and nothing pressed.
  now = { ...fixtureSnapshot(waits(false)), at: "2026-11-19T12:30:10.000Z" };
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: now.at }));
  await waitFor(() => expect(inside()).toBeNull());
  expect(closed()).toEqual(["false", null]);
  expect(within(rowOn(slot, LEAD)!).getByTestId("oats-row-facts").getAttribute("title")).toBe("Working · oats-product-expert");
  // And again, after the person opened and closed it in between (the window's memory of what was opened holds nothing of a mark).
  fireEvent.click(toggles(slot)[0]!);
  fireEvent.click(toggles(slot)[0]!);
  now = { ...fixtureSnapshot(waits(true)), at: "2026-11-19T12:30:15.000Z" };
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: now.at }));
  await waitFor(() => expect(inside()).toBe("needs-you"));
  now = { ...fixtureSnapshot(waits(false)), at: "2026-11-19T12:30:20.000Z" };
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: now.at }));
  await waitFor(() => expect(inside()).toBeNull());
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

test("the Workspace row (ONE row for the page's four tabs, as the Desktop has it) calls toPluginPanel, then onNavigate", async () => {
  const { slot, navigated } = await sidebar();
  await slot.findByTestId("oats-workspace-line");
  // The tabs are not rows of the sidebar.
  for (const path of ["souls", "capabilities", "teams", "machines"]) expect(slot.queryByTestId(`oats-page-link-${path}`)).toBeNull();
  fireEvent.click(slot.getByTestId("oats-page-link-workspace"));
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "workspace" }]);
  expect(navigated()).toBe(1);
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

test("a feature's own page is a row under Workspace, with its mark while its hook gives one", async () => {
  let failed = true;
  const remove = addPageLink({ path: "example", title: "Example", useMark: () => (failed ? { label: "Example, a run failed" } : null) });
  try {
    const { slot } = await sidebar();
    const row = await slot.findByTestId("oats-page-link-example");
    // Workspace first, then what the features added, this one last.
    const rows = Array.from(slot.container.querySelectorAll('[data-testid^="oats-page-link-"]')).map((link) => link.textContent);
    expect(rows[0]).toBe("Workspace");
    expect(rows.at(-1)).toBe("Example");
    const mark = row.querySelector('[data-testid="oats-mark"]')!;
    expect([mark.getAttribute("role"), mark.getAttribute("aria-label")]).toEqual(["img", "Example, a run failed"]);
    // Workspace has no mark.
    expect(slot.getByTestId("oats-page-link-workspace").querySelector('[data-testid="oats-mark"]')).toBeNull();
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
  // Taken away: the block is Workspace again.
  const { slot } = await sidebar();
  await slot.findByTestId("oats-page-link-workspace");
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
  const current = () => ["workspace"].filter((path) => slot.getByTestId(`oats-page-link-${path}`).getAttribute("aria-current") === "page");
  expect(current()).toEqual([]);
  // A tab of the Workspace page is drawn (as app/workspace registers it: its row is Workspace).
  const { shownPage } = await import("../../app/workspace/pages");
  const Teams = shownPage("teams", () => null, "workspace");
  const page = renderSlot<object, Contract>({ component: Teams } as never, {}, { rpc: handlers(), sidebarThreads: sidebarThreads() });
  await waitFor(() => expect(current()).toEqual(["workspace"]));
  expect(slot.getByTestId("oats-page-link-workspace").className).toContain("bg-accent");
  page.unmount();
  await waitFor(() => expect(current()).toEqual([]));
});

// The Workspace page's four tabs are four routes that mark ONE row. Where the next tab is drawn before the last one
// is taken away, the row stays the selected one: only the LAST page that marks it clears it (app/workspace/pages.ts `drawn`).
test("two tabs of the Workspace page drawn at once mark the one row: taking the first away leaves it selected; taking the last away clears it", async () => {
  const { slot } = await sidebar();
  await slot.findByTestId("oats-workspace-line");
  const current = () => slot.getByTestId("oats-page-link-workspace").getAttribute("aria-current") === "page";
  const { shownPage } = await import("../../app/workspace/pages");
  const tab = (path: string) => renderSlot<object, Contract>({ component: shownPage(path, () => null, "workspace") } as never, {}, { rpc: handlers(), sidebarThreads: sidebarThreads() });
  const teams = tab("teams");
  await waitFor(() => expect(current()).toBe(true));
  const machines = tab("machines"); // the next tab's page, drawn while the last one still is
  await waitFor(() => expect(current()).toBe(true));
  teams.unmount(); // the last tab's page goes after the next one came
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(current()).toBe(true);
  machines.unmount();
  await waitFor(() => expect(current()).toBe(false));
  // And again from nothing: the count went back to none, so one page alone marks and clears the row as before.
  const souls = tab("souls");
  await waitFor(() => expect(current()).toBe(true));
  souls.unmount();
  await waitFor(() => expect(current()).toBe(false));
});

// ONE tree for every backend (model/view.ts `rows`; its table is test/model/tree.test.ts): an agent
// with no bb thread is drawn under its parent, indented by its depth, whatever the parent's backend;
// and a row on a bb thread is drawn under a parent that has none.
test("an agent on tmux is drawn under its parent, on a thread or not, indented by its depth; a thread's row under a tmux parent too", async () => {
  const lead = fixtureAgents().find((agent) => agent.instance === "kernel-fix-developer")!;
  const agents = [
    ...fixtureAgents().map((agent) =>
      agent.instance === "kernel-fix-developer"
        ? { ...agent, parent: "redesign-ui-lead" } // on tmux, a child of an agent on a bb thread
        : agent.instance === "weekly-digest-helper"
          ? { ...agent, parent: "tmux-grandchild" } // on a bb thread, a child of an agent on tmux
          : agent,
    ),
    { ...lead, instance: "tmux-grandchild", home: lead.home.replace("kernel-fix-developer", "tmux-grandchild"), alias: "tmux-grandchild", parent: "kernel-fix-developer" },
  ];
  const { slot, navigated } = await sidebar({ snapshot: () => ({ ok: true, at: new Date().toISOString(), deployment: { root: "/abs/deployment", workspace: "oats", machine: "falcon" }, agents }) });
  // As the page loads every parent is closed, the one on tmux as the one on a thread: the roots alone are drawn.
  await slot.findByTestId("oats-tree");
  const rowsNow = () => Array.from(slot.getByTestId("oats-tree").querySelectorAll('[data-testid="oats-agent-row"], [data-testid="oats-agent-row-threadless"]'));
  expect(rowsNow().some((row) => ["kernel-fix-developer", "tmux-grandchild"].includes(row.getAttribute("data-instance") ?? ""))).toBe(false);
  // A thread-less parent has its own chevron, which opens it; here every parent is opened, a parent under a parent too.
  await openParents(slot);
  const toggles = slot.getAllByTestId("oats-row-toggle").map((toggle) => [toggle.getAttribute("data-instance"), toggle.getAttribute("aria-expanded")]);
  expect(toggles).toEqual([
    ["redesign-ui-lead", "true"],
    ["kernel-fix-developer", "true"],
    ["tmux-grandchild", "true"],
  ]);
  // The tree's rows as they are drawn, top to bottom: who, and how far in (the roster has parents: every row is in from the chevrons' gutter).
  const INDENT = ["pl-6", "pl-10", "pl-14"];
  const drawn = Array.from(slot.getByTestId("oats-tree").querySelectorAll('[data-testid="oats-agent-row"], [data-testid="oats-agent-row-threadless"]')).map((row) => [
    row.getAttribute("data-instance") ?? row.getAttribute("data-sidebar-thread-id"),
    INDENT.findIndex((indent) => row.className.split(" ").includes(indent)),
  ]);
  const at = (name: string) => drawn.findIndex(([who]) => who === name);
  // redesign-ui-lead (thr_redesign) has its two children on threads and, after them in the kernel's order, the one on tmux; under that one its tmux child; under that one the agent on a thread.
  expect(drawn.slice(at("thr_redesign"), at("thr_redesign") + 6)).toEqual([
    ["thr_redesign", 0],
    ["thr_mockups", 1],
    ["thr_harvest", 1],
    ["kernel-fix-developer", 1],
    ["tmux-grandchild", 2],
    ["thr_digest", 2],
  ]);
  expect(drawn).toHaveLength(9); // every agent once
  // A thread-less row under a parent is what it was: it opens the agent's own page.
  fireEvent.click(slot.getAllByTestId("oats-agent-row-threadless").find((row) => row.getAttribute("data-instance") === "tmux-grandchild")!);
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "agent", options: { subPath: "tmux-grandchild" } }]);
  expect(navigated()).toBe(1);
});

test("a parent with no bb thread is a parent like any other: Left on its row closes it and Right opens it; closed, it carries after its own word the mark of an agent that waits under it", async () => {
  const lead = fixtureAgents().find((agent) => agent.instance === "kernel-fix-developer")!;
  const claim = { reason: "attention" as const, message: "Which branch?", since: "2026-11-19T12:00:00.000Z" };
  const agents = [...fixtureAgents(), { ...lead, instance: "tmux-child", home: lead.home.replace("kernel-fix-developer", "tmux-child"), alias: "tmux-child", parent: "kernel-fix-developer", running: true, runtimeState: null, waiting: claim }];
  const { slot } = await sidebar({ snapshot: () => ({ ok: true, at: new Date().toISOString(), deployment: { root: "/abs/deployment", workspace: "oats", machine: "falcon" }, agents }) });
  await slot.findByTestId("oats-tree");
  const row = (instance: string) => slot.queryAllByTestId("oats-agent-row-threadless").find((each) => each.getAttribute("data-instance") === instance);
  const toggle = () => slot.getAllByTestId("oats-row-toggle").find((each) => each.getAttribute("data-instance") === "kernel-fix-developer")!;
  /** The mark the parent's chevron carries for a row it hides: its state; null when it carries none. */
  const inside = () => toggle().querySelector('[data-testid="oats-row-toggle-mark"]')!.getAttribute("data-inside");
  // As the page loads it is closed: its child is not in the page; its line says its own words, and its chevron carries the child's mark.
  expect([toggle().getAttribute("aria-expanded"), row("tmux-child")]).toEqual(["false", undefined]);
  expect(inside()).toBe("needs-you");
  expect(within(row("kernel-fix-developer")!).getByTestId("oats-row-facts").getAttribute("title")).toBe("Running · oats-developer · tmux"); // its own words, whole
  expect(row("kernel-fix-developer")!.querySelector("[data-mark]")!.getAttribute("data-state")).toBe("working"); // its own mark stays its own
  // Right on its row opens it: the child's row is there, and the parent carries no mark of it any more.
  fireEvent.keyDown(row("kernel-fix-developer")!, { key: "ArrowRight" });
  expect([toggle().getAttribute("aria-expanded"), row("tmux-child") !== undefined, inside()]).toEqual(["true", true, null]);
  // Right again does nothing (it is open); Left closes it.
  fireEvent.keyDown(row("kernel-fix-developer")!, { key: "ArrowRight" });
  expect(toggle().getAttribute("aria-expanded")).toBe("true");
  fireEvent.keyDown(row("kernel-fix-developer")!, { key: "ArrowLeft" });
  expect([toggle().getAttribute("aria-expanded"), row("tmux-child"), inside()]).toEqual(["false", undefined, "needs-you"]);
});

// The row a person is on keeps its parents open (the fold's `selected`). For a row with no bb thread
// that is its agent's own PAGE: bb tells the sidebar the open thread only, so the page says whose it
// is (app/roster/open-agent.ts; app/panel AgentPage calls it).
/** The roster of the tests of the row on screen: redesign-ui-lead (a thread) > kernel-fix-developer (tmux) > tmux-grandchild (tmux) > weekly-digest-helper (a thread). */
const nested = () => {
  const lead = fixtureAgents().find((agent) => agent.instance === "kernel-fix-developer")!;
  return [
    ...fixtureAgents().map((agent) => (agent.instance === "kernel-fix-developer" ? { ...agent, parent: "redesign-ui-lead" } : agent.instance === "weekly-digest-helper" ? { ...agent, parent: "tmux-grandchild" } : agent)),
    { ...lead, instance: "tmux-grandchild", home: lead.home.replace("kernel-fix-developer", "tmux-grandchild"), alias: "tmux-grandchild", parent: "kernel-fix-developer" },
  ];
};
/** The sidebar drawn beside the plugin's REAL page of one agent (the nav panel "agent", as bb mounts it for `/agent/<instance>`), or beside none. */
async function besidePage(agents: ReturnType<typeof nested>, onPage: string | null, activeThreadId: string | null = null) {
  const app = await loadApp();
  const List = app.threadLists[0]!.component;
  const Page = app.navPanels.find((candidate) => candidate.id === "agent")!.component as (props: { subPath: string }) => ReactNode;
  const slot = renderSlot<PluginThreadListProps, Contract>(
    {
      component: (props: PluginThreadListProps) => (
        <>
          <List {...props} />
          {onPage === null ? null : <Page subPath={onPage} />}
        </>
      ),
    } as never,
    { activeThreadId, activeProjectId: null, isCompactViewport: false, onNavigate: () => undefined, searchQuery: "" },
    { rpc: handlers({ snapshot: () => fixtureSnapshot(agents) }), sidebarThreads: sidebarThreads() },
  );
  await slot.findByTestId("oats-tree");
  const threadless = () => slot.queryAllByTestId("oats-agent-row-threadless").map((row) => row.getAttribute("data-instance"));
  const toggles = () => slot.getAllByTestId("oats-row-toggle").map((toggle) => [toggle.getAttribute("data-instance"), toggle.getAttribute("aria-expanded"), (toggle as HTMLButtonElement).disabled]);
  return { slot, threadless, toggles };
}

// ---- "New agent" is held by ONE rule, here and on the home (the lead's ruling T10 on its reader's report, 24 Nov 2026) ----
type Installed = { version: string | null; desktopApi: number | null; state: "older" | "tested" | "newer" | "unknown" | "newer-api" };
const INSTALLED: Record<Installed["state"], Installed> = {
  tested: { version: "0.70.5", desktopApi: 1, state: "tested" },
  newer: { version: "0.71.0", desktopApi: 1, state: "newer" },
  older: { version: "0.69.4", desktopApi: 1, state: "older" },
  unknown: { version: null, desktopApi: null, state: "unknown" },
  "newer-api": { version: "0.72.0", desktopApi: 2, state: "newer-api" },
};
const asked = (slot: Awaited<ReturnType<typeof sidebar>>["slot"]) => slot.inspection.rpcCalls.filter((call) => call.method === "homeCli").length;

test("the sidebar's New agent is off behind an oats the plugin does not work with, as the home's is: it reads where the installed oats stands itself, once, when it is first seen", async () => {
  const on: Record<string, boolean> = {};
  for (const state of ["tested", "newer", "older", "unknown", "newer-api"] as const) {
    const { slot, navigated } = await sidebar({ homeCli: () => INSTALLED[state] } as Partial<Handlers>);
    await slot.findByTestId("oats-tree");
    await waitFor(() => expect(asked(slot)).toBe(1)); // the sidebar asked: no home was ever opened in this window
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20))); // and its answer has landed: what follows is read of the answer, not of "not read yet"
    const button = () => slot.getByTestId("oats-new-agent") as HTMLButtonElement;
    const held = state === "older" || state === "unknown" || state === "newer-api";
    await waitFor(() => expect(button().disabled).toBe(held));
    on[state] = !button().disabled;
    // Off, it opens nothing; nothing stands beside it or in a title (the home's card says why).
    expect([button().title, button().getAttribute("aria-describedby"), button().textContent]).toEqual(["", null, "New agent"]);
    fireEvent.click(button());
    expect([slot.inspection.navigateCalls.length, navigated()]).toEqual(held ? [0, 0] : [1, 1]);
    expect(asked(slot)).toBe(1); // read once: the roster's events and its reads ask nothing more
    resetApp();
  }
  expect(on).toEqual({ tested: true, newer: true, older: false, unknown: false, "newer-api": false });
});

test("while where the installed oats stands is not read, and when its read fails, the sidebar's New agent is on: nothing is known against it", async () => {
  // Not answered yet.
  let answer: (installed: Installed) => void = () => undefined;
  const waiting = await sidebar({ homeCli: () => new Promise<Installed>((resolve) => (answer = resolve)) } as Partial<Handlers>);
  await waiting.slot.findByTestId("oats-tree");
  await waitFor(() => expect(asked(waiting.slot)).toBe(1));
  const button = () => waiting.slot.getByTestId("oats-new-agent") as HTMLButtonElement;
  expect(button().disabled).toBe(false);
  // The answer is against it: off from then on.
  await act(async () => answer(INSTALLED.older));
  await waitFor(() => expect(button().disabled).toBe(true));
  resetApp();
  // The read fails (twice: the second try once the roster is read): on, and asked no third time.
  const failing = await sidebar({
    homeCli: () => {
      throw new Error("oats did not answer");
    },
  } as Partial<Handlers>);
  await failing.slot.findByTestId("oats-tree");
  await waitFor(() => expect(asked(failing.slot)).toBe(2));
  expect((failing.slot.getByTestId("oats-new-agent") as HTMLButtonElement).disabled).toBe(false);
});

test("the answer is one for the window: the home's Check again, after an install, turns the sidebar's New agent on with the home's, and both are off before it", async () => {
  let installed = INSTALLED.older;
  const app = await loadApp();
  const List = app.threadLists[0]!.component;
  const Home = app.navPanels.find((candidate) => candidate.id === "home")!.component as (props: { subPath: string }) => ReactNode;
  const slot = renderSlot<PluginThreadListProps, Contract>(
    {
      component: (props: PluginThreadListProps) => (
        <>
          <List {...props} />
          <Home subPath="" />
        </>
      ),
    } as never,
    { activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate: () => undefined, searchQuery: "" },
    { rpc: handlers({ homeCli: () => installed } as Partial<Handlers>), sidebarThreads: sidebarThreads() },
  );
  const both = () => [slot.getByTestId("oats-new-agent"), slot.getByTestId("oats-home-new-agent")].map((button) => (button as HTMLButtonElement).disabled);
  await slot.findByTestId("oats-home-cli");
  await waitFor(() => expect(both()).toEqual([true, true]));
  installed = INSTALLED.tested;
  fireEvent.click(slot.getByTestId("oats-home-cli-retry"));
  await waitFor(() => expect(both()).toEqual([false, false]));
  expect(slot.queryByTestId("oats-home-cli")).toBeNull();
});

test("the answer is the window's, a failure is the asker's: the home's own read failing after the sidebar's answered says no \"Check failed\" (nobody pressed); a Check again that fails does", async () => {
  let calls = 0;
  const app = await loadApp();
  const List = app.threadLists[0]!.component;
  const Home = app.navPanels.find((candidate) => candidate.id === "home")!.component as (props: { subPath: string }) => ReactNode;
  const slot = renderSlot<PluginThreadListProps, Contract>(
    {
      component: (props: PluginThreadListProps) => (
        <>
          <List {...props} />
          <Home subPath="" />
        </>
      ),
    } as never,
    { activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate: () => undefined, searchQuery: "" },
    {
      rpc: handlers({
        // The first read (the sidebar's) answers; every read after it fails.
        homeCli: () => {
          calls += 1;
          if (calls === 1) return INSTALLED.older;
          throw new Error("oats did not answer");
        },
      } as Partial<Handlers>),
      sidebarThreads: sidebarThreads(),
    },
  );
  // The card is there by the window's answer; the home's own reads (its first, and its one more try) have failed.
  await slot.findByTestId("oats-home-cli");
  await waitFor(() => expect(calls).toBeGreaterThanOrEqual(2));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
  expect(slot.queryByTestId("oats-home-cli-check-failed")).toBeNull();
  expect([slot.getByTestId("oats-new-agent"), slot.getByTestId("oats-home-new-agent")].map((button) => (button as HTMLButtonElement).disabled)).toEqual([true, true]);
  // A person asks: that check fails, and the card says so; what was read before stays.
  fireEvent.click(slot.getByTestId("oats-home-cli-retry"));
  expect((await slot.findByTestId("oats-home-cli-check-failed")).textContent).toContain("oats did not answer");
  expect(slot.getByTestId("oats-home-cli")).toBeTruthy();
});

test("the page of an agent with no bb thread is on screen: the parents of its row are open as the page loads, by chevrons that are off; nothing below it is opened", async () => {
  // The plugin's own page of that agent, as bb mounts it: it says whose it is (app/panel AgentPage, app/roster/open-agent.ts).
  const { slot, threadless, toggles } = await besidePage(nested(), "tmux-grandchild");
  // No chevron was pressed: its two parents are open, held open by the row on screen (their chevrons are off), and its row is drawn.
  await waitFor(() => expect(threadless()).toEqual(["kernel-fix-developer", "tmux-grandchild"]));
  expect(toggles()).toEqual([
    ["redesign-ui-lead", "true", true],
    ["kernel-fix-developer", "true", true],
    ["tmux-grandchild", "false", false], // what is BELOW the row on screen stays as the person left it: closed
  ]);
  expect(slot.queryAllByTestId("oats-agent-row").some((row) => row.getAttribute("data-sidebar-thread-id") === "thr_digest")).toBe(false);
});

// The lead's ruling P1 on its reader's report (24 Nov 2026): a thread's row is marked while its thread is open; an agent's
// own page marked no row, so a person on it could not tell which row it was. The same mark, with or without a thread.
/** The rows of the tree that are marked as the one on screen: each by its kind and its agent (or its thread). */
const marked = (slot: Awaited<ReturnType<typeof besidePage>>["slot"]) =>
  Array.from(slot.getByTestId("oats-tree").querySelectorAll('[aria-current="page"]')).map((row) => [row.getAttribute("data-testid"), row.getAttribute("data-instance") ?? row.getAttribute("data-sidebar-thread-id"), row.className.split(/\s+/).includes("bg-accent")]);

test("the row of the agent whose page is on screen is marked, as the open thread's row is: an agent with no bb thread, and one on a thread; one row, and none with nothing on screen", async () => {
  // An agent with no bb thread (on tmux, a child's child): its row, and only it.
  const tmux = await besidePage(nested(), "tmux-grandchild");
  await waitFor(() => expect(marked(tmux.slot)).toEqual([["oats-agent-row-threadless", "tmux-grandchild", true]]));
  resetApp();
  // An agent on a bb thread whose own PAGE is on screen (no thread is open): its thread's row.
  const onThread = await besidePage(nested(), "desktop-mockups-developer");
  await waitFor(() => expect(marked(onThread.slot)).toEqual([["oats-agent-row", "thr_mockups", true]]));
  resetApp();
  // Nothing on screen: no row is marked.
  const none = await besidePage(nested(), null);
  expect(marked(none.slot)).toEqual([]);
  resetApp();
  // A thread is open while a page of another agent is still mounted: the thread's row alone, as bb says.
  const both = await besidePage(nested(), "tmux-grandchild", "thr_mockups");
  await both.slot.findByTestId("oats-panel");
  expect(marked(both.slot)).toEqual([["oats-agent-row", "thr_mockups", true]]);
  resetApp();
  // Two rows of one name (a workspace may hold it twice), each on its own thread: the open THREAD's row alone, never both by the name.
  const twin = fixtureAgents().find((agent) => agent.instance === "desktop-mockups-developer")!;
  const twice = await besidePage([...nested(), { ...twin, threadId: "thr_plain", parent: null }], null, "thr_mockups");
  expect(marked(twice.slot)).toEqual([["oats-agent-row", "thr_mockups", true]]);
  resetApp();
  // The same two rows with that name's PAGE on screen and no thread open: one row still, the first of the name.
  const paged = await besidePage([...nested(), { ...twin, threadId: "thr_plain", parent: null }], "desktop-mockups-developer");
  await waitFor(() => expect(marked(paged.slot)).toEqual([["oats-agent-row", "thr_mockups", true]]));
});

test("with no agent's page on screen nothing is held open; and an open THREAD is the row on screen, whatever page last said its agent", async () => {
  // No page: every parent is closed as the page loads.
  const none = await besidePage(nested(), null);
  expect([none.threadless(), none.toggles()]).toEqual([[], [["redesign-ui-lead", "false", false]]]);
  resetApp();
  // A thread is open (a child of the lead, on its thread) while a page of another agent is still mounted: the thread is
  // the row on screen. Its parent is held open; the tmux child beside it is drawn, closed, and nothing under it.
  const both = await besidePage(nested(), "tmux-grandchild", "thr_mockups");
  await both.slot.findByTestId("oats-panel");
  expect(both.threadless()).toEqual(["kernel-fix-developer"]);
  expect(both.toggles()).toEqual([
    ["redesign-ui-lead", "true", true],
    ["kernel-fix-developer", "false", false],
  ]);
});

test("the ARCHIVED thread of an agent is on screen: its row has no thread of bb's list, it names that thread, and its parent is held open over it", async () => {
  // harvest-knowledge-helper is a child of redesign-ui-lead; bb no longer lists its thread (archived): its row is one
  // with no bb thread, and it leads to that archived thread. A person who is there is on that row.
  const draw = async (activeThreadId: string | null) => {
    const app = await loadApp();
    const slot = renderSlot<PluginThreadListProps, Contract>(
      app.threadLists[0]!,
      { activeThreadId, activeProjectId: null, isCompactViewport: false, onNavigate: () => undefined, searchQuery: "" },
      { rpc: handlers({}), sidebarThreads: { status: "ready" as const, threads: fixtureThreads().filter((thread) => thread.id !== "thr_harvest") } },
    );
    await slot.findByTestId("oats-tree");
    const toggle = slot.getAllByTestId("oats-row-toggle").find((each) => each.getAttribute("data-instance") === "redesign-ui-lead")!;
    return { expanded: toggle.getAttribute("aria-expanded"), off: (toggle as HTMLButtonElement).disabled, child: slot.queryAllByTestId("oats-agent-row-threadless").some((row) => row.getAttribute("data-instance") === "harvest-knowledge-helper"), marked: marked(slot).filter(([kind]) => kind !== "oats-other-row") };
  };
  // Nothing on screen: the parent is closed, and the row is not in the page.
  expect(await draw(null)).toEqual({ expanded: "false", off: false, child: false, marked: [] });
  resetApp();
  // Its archived thread on screen: the parent is open, held by it, and the row is drawn, MARKED as the one on screen.
  expect(await draw("thr_harvest")).toEqual({ expanded: "true", off: true, child: true, marked: [["oats-agent-row-threadless", "harvest-knowledge-helper", true]] });
  resetApp();
  // A thread that no agent names: nobody is on screen.
  expect(await draw("thr_plain")).toEqual({ expanded: "false", off: false, child: false, marked: [] });
});

test("two pages in turn: the one that is drawn is the one on screen, and a page that leaves takes away only its own word", async () => {
  const { useOpenAgent, useSayOpenAgent } = await import("../../app/roster/open-agent");
  const Says = ({ instance }: { instance: string | null }) => (useSayOpenAgent(instance), null);
  const Reads = () => <span data-testid="on-screen">{useOpenAgent() ?? "none"}</span>;
  const Both = ({ first, second }: { first: string | null | undefined; second: string | null | undefined }) => (
    <>
      <Reads />
      {first === undefined ? null : <Says key="first" instance={first} />}
      {second === undefined ? null : <Says key="second" instance={second} />}
    </>
  );
  const drawn = render(<Both first="a" second={undefined} />);
  const onScreen = () => drawn.getByTestId("on-screen").textContent;
  expect(onScreen()).toBe("a");
  // The next page is drawn BEFORE the first leaves (bb may mount one route before it unmounts the other): the next is on screen…
  drawn.rerender(<Both first="a" second="b" />);
  expect(onScreen()).toBe("b");
  // …and stays so when the first leaves: a page takes away only what it said itself.
  drawn.rerender(<Both first={undefined} second="b" />);
  expect(onScreen()).toBe("b");
  // A page that names no agent says none; the last page gone, nothing is on screen.
  drawn.rerender(<Both first={undefined} second={null} />);
  expect(onScreen()).toBe("none");
  drawn.rerender(<Both first="c" second={undefined} />);
  expect(onScreen()).toBe("c");
  // A second page of the SAME agent is drawn before the first leaves (a page mounted anew): it is the one on screen,
  // and the first, leaving, does not take the agent away from it.
  drawn.rerender(<Both first="c" second="c" />);
  expect(onScreen()).toBe("c");
  drawn.rerender(<Both first={undefined} second="c" />);
  expect(onScreen()).toBe("c");
  drawn.rerender(<Both first={undefined} second={undefined} />);
  expect(onScreen()).toBe("none");
  drawn.unmount();
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
// home and the Workspace page's four tabs). A page that is not shown has no link in the sidebar and no mark; the count of who
// waits still opens the home; "New agent" stays, whatever pages are shown: the form is a page of its
// own (app/spawn), not one a release leaves out.
test("with the home alone (pages: home) the sidebar has the roster, New agent and no page link; with every page, Workspace and Automations", async () => {
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
  for (const path of ["workspace", "souls", "capabilities", "teams", "machines", "automations"]) expect(pilot.queryByTestId(`oats-page-link-${path}`)).toBeNull();
  expect(pilot.getByTestId("oats-new-agent").textContent).toBe("New agent"); // the way to start an agent survives the hidden pages
  // (The home is reached from bb's own entry for the plugin, which carries the badge: the sidebar has no line that opens it.)
  expect(pilot.queryByTestId("oats-needs-line")).toBeNull();
  fireEvent.click(pilot.getByTestId("oats-new-agent"));
  expect(pilot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "new-agent" }]);
  pilot.unmount();
  resetApp();
  const all = await withPages(ALL_PAGES);
  await all.findByTestId("oats-tree");
  for (const path of ["workspace", "automations"]) expect(all.getByTestId(`oats-page-link-${path}`)).toBeTruthy();
  // Two rows under it: the heading "Workspace" is drawn.
  expect([all.getByTestId("oats-pages-heading").textContent, all.getByTestId("oats-pages-heading").className.includes("sr-only")]).toEqual(["Workspace", false]);
  all.unmount();
  resetApp();
  // The release's default: the ONE row "Workspace". No visible heading over it (the word would stand twice); the list
  // is still named for a screen reader, and keeps the place a heading's block gives it.
  const one = await withPages("home, souls, capabilities, teams, machines");
  await one.findByTestId("oats-tree");
  expect(Array.from(one.getByTestId("oats-pages").querySelectorAll("button")).map((row) => row.textContent)).toEqual(["Workspace"]);
  const heading = one.getByTestId("oats-pages-heading");
  expect([heading.tagName, heading.textContent, heading.className]).toEqual(["H2", "Workspace", "sr-only"]);
  expect(one.getByTestId("oats-pages").className).toContain("pt-8");
  expect(one.getByTestId("oats-new-agent")).toBeTruthy();
  one.unmount();
  resetApp();
  // With the home itself left out: no count either.
  const none = await withPages("souls");
  await none.findByTestId("oats-tree");
  expect(none.queryByTestId("oats-needs-line")).toBeNull();
  expect(none.getByTestId("oats-page-link-workspace")).toBeTruthy(); // one tab shown: the page is there
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
    // The default: the home and the Workspace page's four tabs; not Automations.
    expect([unavailable.known, unavailable.has("home"), unavailable.has("souls"), unavailable.has("machines"), unavailable.has("workspace"), unavailable.has("automations")]).toEqual([true, true, true, true, true, false]);
    const read = pagesOf({ values: { pages: "home, Souls" }, isLoading: false });
    expect([read.known, read.has("home"), read.has("souls"), read.has("teams")]).toEqual([true, true, true, false]);
    // The Workspace page is there while one of its tabs is, and not with the home alone.
    expect([read.has("workspace"), pagesOf({ values: { pages: "home" }, isLoading: false }).has("workspace")]).toEqual([true, false]);
    // A cleared field is the default, as for the plugin's other settings.
    const cleared = pagesOf({ values: { pages: " " }, isLoading: false });
    expect([cleared.has("home"), cleared.has("souls")]).toEqual([true, true]);
    // The values of a read before stay while bb reads them again.
    expect(pagesOf({ values: { pages: "souls" }, isLoading: true }).known).toBe(true);
  } finally {
    showEveryPageWhenUnset(true);
  }
});

// THE NOTICE ONCE, AND ONE RETRY ON A SCREEN (the lead's T3, 24 Nov 2026; the specialist's form): the notice stands in
// the pane a person is looking at, with the one Retry. The sidebar beside such a pane says one line, "Read <age>. Acts
// are off.", with nothing to press; where no pane shows the notice the sidebar's own is the whole one, with the Retry.
// Never two Retry on a screen, never none. (The tab beside a thread draws no notice: test/panel/panel.test.tsx.)
// (A fixed clock: the age these tests read, "Read 2 min ago.", is counted from it, never from the real one.)
const T3_NOW = Date.parse("2026-11-19T12:40:00.000Z");
const T3_LAST = () => ({ at: new Date(T3_NOW - 2 * 60_000 - 5_000).toISOString(), deployment: { root: "/abs/deployment", workspace: "oats", machine: "falcon" }, agents: fixtureAgents() });
const retries = (...places: HTMLElement[]) => places.flatMap((place) => within(place).queryAllByRole("button", { name: "Retry" }));

test("T3, no pane shows the notice: the sidebar's own notice is the whole one, with the one Retry", async () => {
  vi.useFakeTimers({ now: T3_NOW, toFake: ["Date"] });
  const failed = { snapshot: () => ({ ok: false as const, at: new Date(T3_NOW).toISOString(), code: "OATS_TIMEOUT", message: "`oats` did not answer within 20 s and was stopped", machine: "falcon", last: T3_LAST() }) };
  const { slot } = await sidebar(failed);
  await slot.findAllByTestId("oats-agent-row");
  expect(slot.getByTestId("oats-held").textContent).toBe("Acts are off.");
  expect(within(slot.container).getByRole("alert").textContent).toContain("OATS did not answer on falcon");
  expect(slot.queryByTestId("oats-last-observation")).toBeNull();
  expect(retries(slot.container)).toHaveLength(1);
  fireEvent.click(retries(slot.container)[0]!);
  await waitFor(() => expect(slot.inspection.rpcCalls.some((call) => call.method === "refresh")).toBe(true));
});

test("T3, a page shows the notice: the sidebar beside it says one line, \"Read <age>. Acts are off.\", with nothing to press; the ONE Retry is the page's", async () => {
  vi.useFakeTimers({ now: T3_NOW, toFake: ["Date"] });
  const failed = { snapshot: () => ({ ok: false as const, at: new Date(T3_NOW).toISOString(), code: "OATS_TIMEOUT", message: "`oats` did not answer within 20 s and was stopped", machine: "falcon", last: T3_LAST() }) };
  const { slot } = await sidebar(failed);
  await openParents(slot);
  await slot.findAllByTestId("oats-agent-row");
  // A page of the plugin is drawn beside it, with the notice above what it keeps.
  const app = await loadApp();
  const panel = app.navPanels.find((candidate) => candidate.id === "teams")!;
  const page = renderSlot<{ subPath: string }, Contract>(panel, { subPath: "" }, { rpc: handlers(failed), sidebarThreads: sidebarThreads() });
  await waitFor(() => expect(within(page.container).getByTestId("oats-held")).toBeTruthy());
  const line = await waitFor(() => within(slot.container).getByTestId("oats-last-observation"));
  // The line says that the acts are off itself (at a phone's width the sidebar is bb's drawer, over the page and its notice), and has no button and no link.
  expect(line.textContent).toBe("Read 2 min ago. Acts are off.");
  expect([line.querySelectorAll("button").length, line.querySelectorAll("a").length]).toEqual([0, 0]);
  expect(within(slot.container).queryByTestId("oats-held")).toBeNull(); // (one line, not the full notice)
  expect(within(slot.container).queryByRole("alert")).toBeNull();
  // ONE Retry on the screen: the page's.
  expect([retries(slot.container).length, retries(page.container).length]).toEqual([0, 1]);
  // With the sidebar's notice down to one line, New agent stays off and still says no reason of its
  // own, in words or in a title: the line over it says "Acts are off.", and so does the page's full notice beside it.
  const heldNew = within(slot.container).getByTestId("oats-new-agent") as HTMLButtonElement;
  expect([heldNew.disabled, heldNew.title, heldNew.getAttribute("aria-describedby")]).toEqual([true, "", null]);
  expect(within(slot.container).queryByTestId("oats-new-agent-held")).toBeNull();
  expect(slot.container.textContent).not.toContain("Comes back when OATS is read again");
  expect(within(page.container).getByTestId("oats-held").textContent).toBe("Acts are off.");
  expect(within(slot.container).getAllByTestId("oats-agent-row")).toHaveLength(7); // the roster stays
  fireEvent.click(retries(page.container)[0]!);
  await waitFor(() => expect(page.inspection.rpcCalls.some((call) => call.method === "refresh")).toBe(true));
  // The page leaves: the sidebar is the one place again, and says it whole, with the Retry.
  page.unmount();
  await waitFor(() => expect(within(slot.container).getByTestId("oats-held")).toBeTruthy());
  expect(within(slot.container).queryByTestId("oats-last-observation")).toBeNull();
  expect(within(slot.container).queryByTestId("oats-new-agent-held")).toBeNull();
  expect(retries(slot.container)).toHaveLength(1);
});

test("T3, an agent's thread is on screen: its own line says the notice (the age, that the acts are off, the ONE Retry); the sidebar beside it says its one line, with nothing to press", async () => {
  vi.useFakeTimers({ now: T3_NOW, toFake: ["Date"] });
  const failed = { snapshot: () => ({ ok: false as const, at: new Date(T3_NOW).toISOString(), code: "OATS_TIMEOUT", message: "`oats` did not answer within 20 s and was stopped", machine: "falcon", last: T3_LAST() }) };
  const { slot } = await sidebar(failed);
  await slot.findAllByTestId("oats-agent-row");
  expect(retries(slot.container)).toHaveLength(1); // alone, it is the whole notice
  const app = await loadApp();
  const line = renderSlot<{ threadId: string; projectId: string; environment: null }, Contract>(app.threadHeaderRows[0]! as never, { threadId: "thr_mockups", projectId: "p", environment: null }, { rpc: handlers(failed), sidebarThreads: sidebarThreads() });
  const said = await within(line.container).findByTestId("oats-unreadable");
  expect([said.getAttribute("data-compact"), said.textContent]).toEqual(["", "OATS did not answer on falconRead 2 min ago. Acts are off.Retry"]);
  const beside = await waitFor(() => within(slot.container).getByTestId("oats-last-observation"));
  expect(beside.textContent).toBe("Read 2 min ago. Acts are off.");
  expect(within(slot.container).queryByRole("alert")).toBeNull();
  expect([retries(slot.container).length, retries(line.container).length]).toEqual([0, 1]);
  // The thread is left: the sidebar says it whole again.
  line.unmount();
  await waitFor(() => expect(retries(slot.container)).toHaveLength(1));
});

// Where OATS was NEVER read (no roster, no age): the same rule. Beside a pane that shows the notice the sidebar says
// ONE line, the notice's TITLE alone, with nothing to press; alone it keeps the whole notice with the Retry (ruled).
test("T3, OATS never read: alone the sidebar's notice is whole with the one Retry; beside a page that shows it, the sidebar says its title alone and the ONE Retry is the page's", async () => {
  const never = { snapshot: () => ({ ok: false as const, at: "2026-11-19T12:40:00.000Z", code: "OATS_TIMEOUT", message: "`oats` did not answer within 20 s and was stopped", machine: "falcon", last: null }) };
  const { slot } = await sidebar(never);
  await within(slot.container).findByTestId("oats-unreadable");
  expect([retries(slot.container).length, within(slot.container).queryByTestId("oats-last-observation")]).toEqual([1, null]);
  const app = await loadApp();
  const panel = app.navPanels.find((candidate) => candidate.id === "home")!;
  const page = renderSlot<{ subPath: string }, Contract>(panel, { subPath: "" }, { rpc: handlers(never), sidebarThreads: sidebarThreads() });
  await within(page.container).findByTestId("oats-unreadable");
  const line = await waitFor(() => within(slot.container).getByTestId("oats-last-observation"));
  expect(line.textContent).toBe("OATS did not answer on falcon");
  expect([line.querySelectorAll("button").length, line.querySelectorAll("a").length, within(slot.container).queryByTestId("oats-unreadable")]).toEqual([0, 0, null]);
  expect([retries(slot.container).length, retries(page.container).length]).toEqual([0, 1]);
  page.unmount();
  await waitFor(() => expect(retries(slot.container)).toHaveLength(1));
});

// The second review round: where OATS was never read, the panel in a thread's TAB drew the roster's notice whole beside
// the thread's own line: the notice twice, two Retry. The tab draws none there either.
test("T3, OATS never read, an agent's thread with its panel's tab shown: the thread's line says the notice with the ONE Retry; the tab draws none", async () => {
  const never = { snapshot: () => ({ ok: false as const, at: "2026-11-19T12:40:00.000Z", code: "OATS_TIMEOUT", message: "`oats` did not answer within 20 s and was stopped", machine: "falcon", last: null }), panelInstance: () => { throw new Error("OATS_TIMEOUT: `oats` did not answer within 20 s and was stopped"); } };
  const app = await loadApp();
  const line = renderSlot<{ threadId: string; projectId: string; environment: null }, Contract>(app.threadHeaderRows[0]! as never, { threadId: "thr_mockups", projectId: "p", environment: null }, { rpc: handlers(never), sidebarThreads: sidebarThreads() });
  await within(line.container).findByTestId("oats-unreadable");
  const { InstancePanel } = await import("../../app/panel/Panel");
  const known = fixtureAgents().find((agent) => agent.instance === "desktop-mockups-developer")!;
  const tab = renderSlot<{ threadId: string; known: typeof known }, Contract>({ component: InstancePanel }, { threadId: "thr_mockups", known }, { rpc: handlers(never), sidebarThreads: sidebarThreads() });
  await within(tab.container).findByTestId("oats-panel");
  await waitFor(() => expect(within(tab.container).queryByRole("alert")).toBeNull());
  expect([retries(line.container).length, retries(tab.container).length]).toEqual([1, 0]);
});

// Where OATS was never read, every thread's line says the notice: the home in that thread's tab does not say it a
// second time, and is never an empty pane: ONE line, the notice's title alone, with nothing to press (ruled).
test("T3, OATS never read, a thread with the home's tab shown: the line says the notice with the ONE Retry; the tab's home says the title alone", async () => {
  const never = { snapshot: () => ({ ok: false as const, at: "2026-11-19T12:40:00.000Z", code: "OATS_TIMEOUT", message: "`oats` did not answer within 20 s and was stopped", machine: "falcon", last: null }) };
  const app = await loadApp();
  const line = renderSlot<{ threadId: string; projectId: string; environment: null }, Contract>(app.threadHeaderRows[0]! as never, { threadId: "thr_no_agent", projectId: "p", environment: null }, { rpc: handlers(never), sidebarThreads: sidebarThreads() });
  await within(line.container).findByTestId("oats-unreadable");
  const tab = renderSlot<{ threadId: string; environment: null }, Contract>(app.tabs[0]! as never, { threadId: "thr_no_agent", environment: null }, { rpc: handlers(never), sidebarThreads: sidebarThreads(), tabVisible: true });
  const said = await waitFor(() => within(tab.container).getByTestId("oats-last-observation"));
  expect([said.textContent, said.querySelectorAll("button, a").length, within(tab.container).queryByTestId("oats-unreadable")]).toEqual(["OATS did not answer on falcon", 0, null]);
  expect([retries(line.container).length, retries(tab.container).length]).toEqual([1, 0]);
});

// The first review round of this change: bb keeps the plugin's fixed tab MOUNTED while its side panel is closed (or
// another tab is chosen). A notice in a place nobody sees is no pane's notice: it must not take the sidebar's Retry.
test("T3, a thread that is no agent's, the home's tab HIDDEN (bb keeps it mounted): the tab says no notice and the sidebar keeps its own, whole, with the one Retry; shown, the tab says it and the sidebar says its line", async () => {
  vi.useFakeTimers({ now: T3_NOW, toFake: ["Date"] });
  const failed = { snapshot: () => ({ ok: false as const, at: new Date(T3_NOW).toISOString(), code: "OATS_TIMEOUT", message: "`oats` did not answer within 20 s and was stopped", machine: "falcon", last: T3_LAST() }) };
  const { slot } = await sidebar(failed);
  await slot.findAllByTestId("oats-agent-row");
  const app = await loadApp();
  const hidden = renderSlot<{ threadId: string; environment: null }, Contract>(app.tabs[0]! as never, { threadId: "thr_no_agent", environment: null }, { rpc: handlers(failed), sidebarThreads: sidebarThreads(), tabVisible: false });
  await within(hidden.container).findByTestId("oats-home-needs"); // drawn, out of sight
  expect(within(hidden.container).queryByTestId("oats-unreadable")).toBeNull();
  expect(within(slot.container).queryByTestId("oats-last-observation")).toBeNull();
  expect(within(slot.container).getByTestId("oats-held").textContent).toBe("Acts are off.");
  expect([retries(slot.container).length, retries(hidden.container).length]).toEqual([1, 0]);
  hidden.unmount();
  // The same tab in view: it is the pane a person looks at.
  const shownTab = renderSlot<{ threadId: string; environment: null }, Contract>(app.tabs[0]! as never, { threadId: "thr_no_agent", environment: null }, { rpc: handlers(failed), sidebarThreads: sidebarThreads(), tabVisible: true });
  await within(shownTab.container).findByTestId("oats-unreadable");
  await waitFor(() => expect(within(slot.container).getByTestId("oats-last-observation").textContent).toBe("Read 2 min ago. Acts are off."));
  expect([retries(slot.container).length, retries(shownTab.container).length]).toEqual([0, 1]);
});

test("T3, a thread whose own line says the notice, with the home's tab open beside it: the tab's home says none (it would be a second, with a second Retry)", async () => {
  vi.useFakeTimers({ now: T3_NOW, toFake: ["Date"] });
  const failed = { snapshot: () => ({ ok: false as const, at: new Date(T3_NOW).toISOString(), code: "OATS_TIMEOUT", message: "`oats` did not answer within 20 s and was stopped", machine: "falcon", last: T3_LAST() }) };
  const app = await loadApp();
  // The home in a thread's tab (shown), and on the same screen a thread's line that says the notice.
  const tab = renderSlot<{ threadId: string; environment: null }, Contract>(app.tabs[0]! as never, { threadId: "thr_no_agent", environment: null }, { rpc: handlers(failed), sidebarThreads: sidebarThreads(), tabVisible: true });
  await within(tab.container).findByTestId("oats-unreadable");
  const line = renderSlot<{ threadId: string; projectId: string; environment: null }, Contract>(app.threadHeaderRows[0]! as never, { threadId: "thr_mockups", projectId: "p", environment: null }, { rpc: handlers(failed), sidebarThreads: sidebarThreads() });
  await within(line.container).findByTestId("oats-unreadable");
  await waitFor(() => expect(within(tab.container).queryByTestId("oats-unreadable")).toBeNull());
  expect([retries(tab.container).length, retries(line.container).length]).toEqual([0, 1]);
  expect(within(tab.container).getByTestId("oats-home-needs")).toBeTruthy(); // the home itself stays
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

// The chevron's mark, per state: closed points RIGHT, open points DOWN, and the off one (its parent holds the row on
// screen) is drawn as the open one. Two marks, never one turned: no rotation and no transition (a turned glyph was
// caught mid-turn in an image, pointing left); and one box of one size, whatever the width.
// (Beside a hidden row's mark the chevron's box is as wide as its glyph and stands at the gutter's start, a few pixels
// left of a plain parent's: the gutter holds both, and what is left stands between that mark and the parent's own dot.
// Pinned below.)
test("the chevron's mark: right while closed, down while open, the off one as open; never a turned glyph, and the same box in every state", async () => {
  const mark = (slot: { container: HTMLElement }) => {
    const element = toggles(slot)[0]!.querySelector<HTMLElement>('[data-testid="oats-row-toggle-mark"]')!;
    return { glyph: element.textContent, open: element.getAttribute("data-open"), hidden: element.getAttribute("aria-hidden"), classes: element.className.split(/\s+/).sort().join(" "), turned: /rotate|transition|transform/.test(`${element.className} ${toggles(slot)[0]!.className}`), styled: element.getAttribute("style") };
  };
  const BOX = "inline-flex items-center justify-center leading-none size-4 text-xs";
  const { slot } = await sidebar();
  await slot.findByTestId("oats-tree");
  const closed = mark(slot);
  expect(closed).toEqual({ glyph: "▸", open: "false", hidden: "true", classes: BOX, turned: false, styled: null });
  fireEvent.click(toggles(slot)[0]!);
  const open = mark(slot);
  expect(open).toEqual({ glyph: "▾", open: "true", hidden: "true", classes: BOX, turned: false, styled: null });
  fireEvent.click(toggles(slot)[0]!);
  expect(mark(slot).glyph).toBe("▸");
  cleanup();
  resetApp();
  // Off: the parent holds the thread on screen. Drawn as the open form, in the same box.
  const pinned = await sidebar({}, "thr_mockups");
  await pinned.slot.findByTestId("oats-tree");
  expect((toggles(pinned.slot)[0] as HTMLButtonElement).disabled).toBe(true);
  expect(mark(pinned.slot)).toEqual(open);
  // No size of the mark or of its button depends on the width: no class of a breakpoint on either.
  expect(`${toggles(pinned.slot)[0]!.className} ${open.classes}`).not.toMatch(/\b(sm|md|lg|xl):/);
});

// ---- A row behind a result (the second look's sixth item, 25 Nov 2026) ----
// Between an act's result and the roster read after it, the thread's line and the page of every agent the act took say
// "Reading…"; the ROW kept the roster's word of before, and after a Stop that archived the threads the rows read
// "Idle · … · may still run", in the warning tone, beside "3 sessions stopped.". A row says "Reading…" too.
const AT = fixtureSnapshot().at; // the roster the window holds: read no later than the act's end
const LATER = "2026-11-19T12:30:05.000Z"; // a roster read after it
const TOOK = ["redesign-ui-lead", "desktop-mockups-developer", "harvest-knowledge-helper"]; // a stop of the lead takes its two children
const THREADS = ["thr_redesign", "thr_mockups", "thr_harvest"];
/** What a row draws after its name: the word in the facts' place, or the facts; and its mark's state (null: the plain mark). */
const drawn = (row: HTMLElement) => ({
  reading: row.querySelector('[data-testid="oats-row-reading"]')?.textContent ?? null,
  facts: row.querySelector('[data-testid="oats-row-facts"]')?.textContent ?? null,
  mark: row.querySelector("[data-mark]")?.getAttribute("data-state") ?? null,
  tone: row.querySelector("[data-mark]")?.getAttribute("data-tone") ?? null,
  plain: row.querySelector("[data-mark]")?.hasAttribute("data-reading") ?? false,
});

test("behind a result every row the act took says Reading… in its facts' place, with a plain mark and no reason, and stays a link; the next roster read says Stopped; no other row changes", async () => {
  let stopped = false;
  const agents = () => fixtureAgents().map((agent) => (stopped && TOOK.includes(agent.instance) ? { ...agent, running: false, runtimeState: "stopped", sessionEnd: "stopped", waiting: null } : agent));
  const { slot } = await sidebar({ snapshot: () => ({ ...fixtureSnapshot(agents()), at: stopped ? LATER : AT }) });
  await openParents(slot);
  const rows = () => THREADS.map((thread) => rowOn(slot, thread)!);
  const other = () => rowOn(slot, "thr_release")!;
  const before = rows().map(drawn);
  const otherBefore = drawn(other());
  expect(before.every((row) => row.reading === null && row.facts !== null && row.mark !== null)).toBe(true);
  // The act's result: the three are marked; the roster on screen is still the one from before the act's end.
  act(() => noteActed(TOOK, AT));
  expect(rows().map(drawn)).toEqual([0, 1, 2].map(() => ({ reading: "Reading…", facts: null, mark: null, tone: null, plain: true })));
  for (const row of rows()) {
    expect(row.tagName).toBe("A"); // still the thread's link
    expect(row.getAttribute("href")).not.toBeNull();
    expect(row.textContent).not.toMatch(/Working|Idle|Needs you|may still run|oats-/); // no state's word, no soul, no reason
  }
  expect(drawn(other())).toEqual(otherBefore); // an agent the act did not take
  // The roster read after the act: the rows say what it says.
  stopped = true;
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: LATER }));
  await waitFor(() => expect(rows().map((row) => drawn(row).facts?.startsWith("Stopped"))).toEqual([true, true, true]));
  expect(rows().map((row) => [drawn(row).reading, drawn(row).mark, drawn(row).plain])).toEqual([0, 1, 2].map(() => [null, "stopped", false]));
});

test("a closed parent marks nothing for a hidden row that says Reading…: its state in the roster on screen is from before the act", async () => {
  // The lead's child waits on a person: closed, the lead's chevron carries that mark.
  const claim = { reason: "attention" as const, message: "Which mockup?", since: "2026-11-19T12:00:00.000Z" };
  const agents = fixtureAgents().map((agent) => (agent.instance === "desktop-mockups-developer" ? { ...agent, waiting: claim } : agent));
  const { slot } = await sidebar({ snapshot: () => fixtureSnapshot(agents) });
  await slot.findByTestId("oats-tree");
  const toggle = () => toggles(slot).find((each) => each.getAttribute("data-instance") === "redesign-ui-lead")!;
  const inside = () => toggle().querySelector('[data-testid="oats-row-toggle-mark"]')!.getAttribute("data-inside");
  expect([toggle().getAttribute("aria-expanded"), inside()]).toEqual(["false", "needs-you"]);
  // An act took that child (it was stopped): until the roster is read again the parent marks nothing for it.
  act(() => noteActed(["desktop-mockups-developer"], AT));
  expect([inside(), toggle().getAttribute("aria-label")]).toEqual([null, "Show Redesign ui lead's agents"]);
  // Opened, the child's row says Reading….
  fireEvent.click(toggle());
  expect(drawn(rowOn(slot, "thr_mockups")!)).toEqual({ reading: "Reading…", facts: null, mark: null, tone: null, plain: true });
});

test("an agent with no bb thread says Reading… on its row too; and the home's list of every agent says it where it draws that agent, with no state's word at the row's end", async () => {
  const { slot } = await sidebar();
  await openParents(slot);
  const tmux = () => slot.getAllByTestId("oats-agent-row-threadless").find((row) => row.getAttribute("data-instance") === "kernel-fix-developer")!;
  expect(drawn(tmux()).facts).toBe("Running · oats-developer · tmux");
  act(() => noteActed(["kernel-fix-developer"], AT));
  expect(drawn(tmux())).toEqual({ reading: "Reading…", facts: null, mark: null, tone: null, plain: true });
  expect(tmux().tagName).toBe("BUTTON"); // it still opens its page
  resetApp();
  // The home's list (Home › Agents): the same word, in the facts' place.
  const app = await loadApp();
  const home = renderSlot<{ subPath: string }, Contract>(app.navPanels.find((candidate) => candidate.id === "home")!, { subPath: "agents" }, { rpc: handlers(), sidebarThreads: sidebarThreads() });
  const row = async () => (await home.findAllByTestId("oats-home-agent-row")).find((each) => each.dataset.instance === "desktop-mockups-developer")!;
  expect(within(await row()).getByTestId("oats-state").textContent).toBe("Working");
  act(() => noteActed(["desktop-mockups-developer"], AT));
  expect(within(await row()).getByTestId("oats-home-agent-reading").textContent).toBe("Reading…");
  expect(within(await row()).queryByTestId("oats-state")).toBeNull();
  expect(within(await row()).queryByTestId("oats-home-agent-where")).toBeNull();
});

test("a row that waits on a person is not bold while it says Reading…: the claim is of the roster from before the act", async () => {
  const { slot } = await sidebar();
  await openParents(slot);
  const name = () => within(rowOn(slot, "thr_release")!).getByTestId("oats-row-name").className.split(/\s+/);
  expect(name()).toContain("font-semibold");
  act(() => noteActed(["release-070-maintainer"], AT));
  expect(name()).not.toContain("font-semibold");
  expect(drawn(rowOn(slot, "thr_release")!).reading).toBe("Reading…");
});

