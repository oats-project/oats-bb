// @vitest-environment jsdom
// A10: the OATS home (navPanel `home`, and the fixed thread tab) and its badge.
import { afterEach, expect, test, vi } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import type { ComponentType } from "react";
import type { ExperimentalBadge, ExperimentalThreadTabProps } from "@get-bb/plugin-sdk/app";
import { fixtureAgents, fixtureSnapshot, fixtureThreads } from "../helpers/fixtures";
import { OATS_FLOOR } from "../../kernel/compat";
import { handlers, loadApp, resetApp, sidebarThreads } from "../helpers/render";
import type { Contract, Handlers } from "../helpers/render";
import { setAgentTab } from "../../app/home/agent-tab";
import type { Agent } from "../../model/types";

afterEach(() => {
  resetApp();
  vi.useRealTimers();
});
/** A test that pins how long an agent has waited ("4 d") reads no clock but this one: the day the sample's claims were four days old. */
const FOUR_DAYS_ON = Date.parse("2026-11-23T18:00:00.000Z");

const quiet = (): Agent[] =>
  fixtureAgents().map((agent) => ({ ...agent, waiting: null, running: agent.running === true ? null : agent.running }));
const calm = () => {
  const threads = sidebarThreads();
  return { ...threads, threads: threads.threads.map((thread) => ({ ...thread, hasPendingInteraction: false, isUnread: false, status: "idle" as const })) };
};

/** bb lists nothing pending: the cards show the kernel's claims. */
const NO_INTERACTIONS = { threads: { interactions: { list: async () => [] as never } } };

async function homePage(options: RenderSlotOptions<Contract> = {}) {
  const app = await loadApp();
  const panel = app.navPanels.find((candidate) => candidate.id === "home")!;
  expect(panel.path).toBe("home");
  expect(panel.experimental_hideFromNavigation).toBeUndefined(); // shown in bb's navigation
  return renderSlot<{ subPath: string }, Contract>(panel, { subPath: "" }, { rpc: handlers(), sidebarThreads: sidebarThreads(), sdk: NO_INTERACTIONS, ...options });
}

const heading = (section: HTMLElement) => section.querySelector("h2")!.textContent;
const cardOf = async (slot: Awaited<ReturnType<typeof homePage>>, instance: string) => (await slot.findAllByTestId("oats-needs-card")).find((card) => card.dataset.instance === instance)!;

test("what needs you first, then the tiles, who works and what is unread; no heading of its own and no summary line", async () => {
  const slot = await homePage();
  const needs = await slot.findByTestId("oats-home-needs");
  expect(heading(needs)).toBe("Needs you3");
  expect(within(needs).getAllByTestId("oats-needs-card")).toHaveLength(3);
  // bb's bar over the page names it: the page has no heading "Home" of its own.
  expect(slot.queryByTestId("oats-home-title")).toBeNull();
  expect(slot.getByTestId("oats-home-page").querySelector("h1")).toBeNull();
  // No summary line here: the headings count who needs you and who works. And no tile for the agents: the sidebar lists every one.
  expect(slot.queryByTestId("oats-home-summary")).toBeNull();
  expect(slot.queryByTestId("oats-tile-agents")).toBeNull();
  const working = slot.getByTestId("oats-home-working");
  expect(heading(working)).toBe(`Running${within(working).getAllByTestId("oats-working-row").length}`); // (the heading is true of all its rows: a tmux agent that runs is among them; the lead's T4)
  // The heading says the state: no row under it repeats the word.
  for (const row of within(working).getAllByTestId("oats-working-row")) expect(within(row).queryByTestId("oats-state")).toBeNull();
  const finished = slot.getByTestId("oats-home-finished");
  expect(heading(finished)).toBe("Unread1");
  for (const row of within(finished).getAllByTestId("oats-finished-row")) expect(within(row).queryByTestId("oats-state")).toBeNull();
  expect(within(finished).getAllByTestId("oats-finished-row").map((row) => row.dataset.instance)).toEqual(["harvest-knowledge-helper"]);
  // in the page's order: what needs the person comes before everything else
  const order = ["oats-home-needs", "oats-home-tiles", "oats-home-working", "oats-home-finished"].map((id) => slot.getByTestId(id));
  for (let i = 1; i < order.length; i++) expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("a card says who (the name as words, its soul on its line, and no machine), what it asks and how long it has waited; its name and Open lead to its thread", async () => {
  const slot = await homePage();
  const release = await cardOf(slot, "release-070-maintainer");
  expect(within(release).getByTestId("oats-needs-name").textContent).toBe("Release 070 maintainer");
  // The name in its weight is the link: no underline at rest; it shows on hover and on keyboard focus. It stays a link, by its name.
  const named = within(release).getByTestId("oats-needs-name");
  expect(named.className.split(/\s+/)).not.toContain("underline");
  expect(named.className.split(/\s+/)).toEqual(expect.arrayContaining(["font-semibold", "hover:underline", "focus-visible:underline"]));
  expect([named.tagName, named.getAttribute("href") !== null]).toEqual(["A", true]);
  // A row of the Working list: one line (its name, then its soul), the same link, and no rule between rows.
  const worker = within(slot.getByTestId("oats-home-working")).getAllByTestId("oats-working-row")[0]!;
  expect(worker.className).not.toMatch(/border/);
  expect(within(worker).getByTestId("oats-home-agent").className.split(/\s+/)).not.toContain("underline");
  const workerFacts = within(worker).getByTestId("oats-home-agent-where");
  expect([workerFacts.textContent, workerFacts.getAttribute("title"), workerFacts.className.split(/\s+/).includes("whitespace-nowrap")]).toEqual(["oats-product-expert", "oats-product-expert", true]);
  expect(workerFacts.querySelector('[data-phrase="soul"]')!.className.split(/\s+/)).toEqual(expect.arrayContaining(["shrink", "truncate"])); // the soul is the part that gives way
  // Its soul is on the card, on its name's line (Joan, 24 Nov: "Keep the agent type"; the reader's P5: one line); its machine is on its page.
  expect(within(release).getByTestId("oats-needs-where").textContent).toBe("oats-maintainer");
  // That line is ONE line high on a card: it stands in a ROW, beside the name, where its flex base is a WIDTH. (In a
  // column a flex base is a height: a base of ten rem once left an empty 150 px under the soul on every card; the live
  // scene measures the cards' boxes.) On a card and in a list's row alike it takes what the name leaves, from nothing.
  const cardFacts = within(release).getByTestId("oats-needs-where");
  expect(cardFacts.parentElement!.className.split(/\s+/)).not.toContain("flex-col");
  expect(cardFacts.parentElement!.parentElement!.contains(within(release).getByTestId("oats-needs-name"))).toBe(true); // the name's own line
  expect(cardFacts.className.split(/\s+/).filter((name) => /^(h-|min-h-)/.test(name))).toEqual([]);
  expect(workerFacts.className.split(/\s+/)).toEqual(expect.arrayContaining(["min-w-0", "flex-1", "basis-0"]));
  // WHERE the facts stand is THE FIT's (app/home/Home.tsx `factsFit`, one measure for a card and a row; its own tests
  // below). With no layout (this DOM) it is "beside": the card's name, then ONE unit (the facts, then the mark with its
  // age), on one line that does not wrap; a row's name and facts on one line that does not wrap.
  const unit = cardFacts.parentElement!;
  expect(unit.getAttribute("data-testid")).toBe("oats-needs-facts");
  expect(cardFacts.className.split(/\s+/)).toEqual(expect.arrayContaining(["min-w-0", "flex-1", "basis-0"]));
  expect(unit.contains(within(release).getByTestId("oats-status-line"))).toBe(true);
  expect([unit.parentElement!.getAttribute("data-fit"), unit.parentElement!.className.split(/\s+/).includes("flex-wrap")]).toEqual(["beside", false]);
  expect(unit.parentElement!.contains(within(release).getByTestId("oats-needs-name"))).toBe(true);
  expect([workerFacts.parentElement!.getAttribute("data-fit"), workerFacts.parentElement!.className.split(/\s+/).includes("flex-wrap")]).toEqual(["beside", false]);
  // The mark and the age stand at the end of that line (P5), not on a line of their own.
  expect(cardFacts.parentElement!.parentElement!.contains(within(release).getByTestId("oats-status-line"))).toBe(true);
  expect(release.textContent).not.toMatch(/falcon/);
  expect(within(release).getByTestId("oats-needs-where").querySelector('[data-phrase="reason"], [data-phrase="where"]')).toBeNull(); // on its thread: no reason, no glyph
  // Under "Needs you" the heading says the word: the card keeps the mark, named for a screen reader, and the wait.
  expect(within(release).getByTestId("oats-state").textContent).toBe("!");
  expect(within(release).getByTestId("oats-state").querySelector('[data-mark][role="img"]')!.getAttribute("aria-label")).toBe("Needs input"); // (the mark's own name, as on every row)
  expect(release.textContent).not.toMatch(/Needs you/i); // the heading over the cards says it, once
  expect(within(release).getByTestId("oats-needs-open").textContent).toBe("Open");
  expect(within(release).getByTestId("oats-needs-open").getAttribute("aria-label")).toBe("Open thread: Release 070 maintainer"); // one word; its name says where it leads
  expect(within(release).getByTestId("oats-needs-question").textContent).toBe("Green light at 9f2e1c? Second reader done.");
  fireEvent.click(within(release).getByTestId("oats-needs-open"));
  fireEvent.click(within(slot.getByTestId("oats-home-working")).getAllByTestId("oats-home-agent")[0]!);
  expect(slot.inspection.navigateCalls.map((call) => call.method)).toEqual(["toThread", "toThread"]);
  expect(slot.inspection.navigateCalls[0]).toEqual({ method: "toThread", threadId: "thr_release" });
});

test('with none: "Nothing needs you.", once and here; no summary line, and an empty group is not drawn', async () => {
  const slot = await homePage({ rpc: handlers({}, quiet()), sidebarThreads: calm() });
  const needs = await slot.findByTestId("oats-home-needs");
  expect(needs.textContent).toBe("Needs you0Nothing needs you.");
  expect(slot.queryByTestId("oats-home-summary")).toBeNull();
  expect(slot.queryByTestId("oats-home-working")).toBeNull();
  expect(slot.queryByTestId("oats-home-finished")).toBeNull();
  expect(slot.queryByTestId("oats-reply")).toBeNull();
});

async function badge(options: RenderSlotOptions<Contract>): Promise<() => ExperimentalBadge | null | "unset"> {
  const app = await loadApp();
  const useBadge = app.navPanels.find((candidate) => candidate.id === "home")!.experimental_useBadge!;
  let latest: ExperimentalBadge | null | "unset" = "unset";
  let snapshots = 0;
  const rpc = options.rpc ?? handlers();
  renderSlot<object, Contract>(
    {
      component: function Badge() {
        latest = useBadge();
        return null;
      },
    },
    {},
    { sidebarThreads: sidebarThreads(), ...options, rpc: { ...rpc, snapshot: (input) => (snapshots++, rpc.snapshot(input)) } },
  );
  await waitFor(() => expect(snapshots).toBe(1));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return () => latest;
}

test("the badge hook returns the count of agents that need you, with the warning tone", async () => {
  const latest = await badge({});
  await waitFor(() => expect(latest()).toEqual({ count: 3, tone: "warning", label: "3 agents need you" }));
});

test("the badge hook returns null at 0", async () => {
  const latest = await badge({ rpc: handlers({}, quiet()), sidebarThreads: calm() });
  expect(latest()).toBeNull();
});

test("the badge hook returns null while OATS cannot be read", async () => {
  const latest = await badge({
    rpc: handlers({ snapshot: () => ({ ok: false, at: "t", code: "OATS_NOT_FOUND", message: "oats: not found" }) }),
  });
  expect(latest()).toBeNull();
});

test("a pending interaction with no claim: bb's title is the question, and its choices answer in place", async () => {
  const agents = fixtureAgents().map((agent) => (agent.instance === "flaky-ci-developer" ? { ...agent, waiting: null } : agent));
  let pending = true;
  const slot = await homePage({
    rpc: handlers({}, agents),
    sdk: {
      threads: {
        interactions: {
          list: async () =>
            (pending
              ? [
                  {
                    id: "pint_1",
                    threadId: "thr_ci",
                    status: "pending",
                    payload: { kind: "provider-pi/extension-ui", title: "Confirm", data: { requestId: "r1", method: "confirm", fullTitle: "Force-push to fix/ci-race?" } },
                  },
                ]
              : []) as never,
          respond: async () => ((pending = false), {}) as never,
        },
      },
    },
  });
  const card = (await slot.findAllByTestId("oats-needs-card")).find((candidate) => candidate.dataset.instance === "flaky-ci-developer")!;
  await waitFor(() => expect(within(card).getByTestId("oats-needs-question").textContent).toBe("Force-push to fix/ci-race?"));
  const choices = within(card).getAllByTestId("oats-needs-choice");
  expect(choices.map((choice) => choice.textContent)).toEqual(["Yes", "No"]);
  fireEvent.click(choices[0]!);
  await waitFor(() => expect(within(card).queryAllByTestId("oats-needs-choice")).toEqual([]));
  expect(slot.inspection.sdkCalls.filter((call) => call.method === "threads.interactions.respond")).toEqual([
    { method: "threads.interactions.respond", args: [{ threadId: "thr_ci", interactionId: "pint_1", value: true }] },
  ]);
  // only the thread bb reports a pending interaction for was asked about
  expect(slot.inspection.sdkCalls.filter((call) => call.method === "threads.interactions.list").map((call) => (call.args[0] as { threadId: string }).threadId)).toEqual(["thr_ci"]);
});

test("an approval beside the kernel's claim: the claim, what is approved, and Allow answers through resolve", async () => {
  let pending = true;
  const slot = await homePage({
    sdk: {
      threads: {
        interactions: {
          list: async () =>
            (pending
              ? [
                  {
                    id: "pint_2",
                    threadId: "thr_ci",
                    status: "pending",
                    payload: { kind: "approval", reason: "scripted", subject: { kind: "command", command: "git push --force origin fix/ci-race" }, availableDecisions: ["allow_once", "allow_for_session", "deny"] },
                  },
                ]
              : []) as never,
          resolve: async () => ((pending = false), {}) as never,
        },
      },
    },
  });
  const card = (await slot.findAllByTestId("oats-needs-card")).find((candidate) => candidate.dataset.instance === "flaky-ci-developer")!;
  await waitFor(() => expect(within(card).getAllByTestId("oats-needs-choice").map((choice) => choice.textContent)).toEqual(["Allow", "Deny"]));
  expect(within(card).getByTestId("oats-needs-question").textContent).toBe("needs your permission to use Bash"); // the kernel's claim
  expect(within(card).getByTestId("oats-needs-detail").textContent).toBe("Run: git push --force origin fix/ci-race");
  fireEvent.click(within(card).getAllByTestId("oats-needs-choice")[0]!);
  await waitFor(() => expect(within(card).queryAllByTestId("oats-needs-choice")).toEqual([]));
  expect(slot.inspection.sdkCalls.filter((call) => call.method.startsWith("threads.interactions.res"))).toEqual([
    { method: "threads.interactions.resolve", args: [{ threadId: "thr_ci", interactionId: "pint_2", resolution: { decision: "allow_once", grantedPermissions: null } }] },
  ]);
});

test("a question with options answers through resolve with the option's value; a refused answer is shown and the choices stay", async () => {
  let refuse = true;
  const slot = await homePage({
    sdk: {
      threads: {
        interactions: {
          list: async () =>
            [{ id: "pint_3", threadId: "thr_ci", status: "pending", payload: { kind: "user_question", questions: [{ id: "q1", prompt: "Which depth?", multiSelect: false, allowFreeText: false, options: [{ label: "Depth 6", value: "6" }, { label: "Depth 7", value: "7" }] }] } }] as never,
          resolve: async () => {
            if (refuse) throw new Error("interaction is no longer pending");
            return {} as never;
          },
        },
      },
    },
  });
  const card = (await slot.findAllByTestId("oats-needs-card")).find((candidate) => candidate.dataset.instance === "flaky-ci-developer")!;
  await waitFor(() => expect(within(card).getAllByTestId("oats-needs-choice").map((choice) => choice.textContent)).toEqual(["Depth 6", "Depth 7"]));
  fireEvent.click(within(card).getAllByTestId("oats-needs-choice")[1]!);
  const refused = await within(card).findByRole("alert");
  expect(refused.querySelector("h3")!.textContent).toBe("The answer was not sent");
  // Why is the card's one line, in view: never only behind a fold (a person would press again).
  expect(refused.textContent).toBe("The answer was not sentinteraction is no longer pending");
  expect(within(refused).queryByTestId("oats-notice-details")).toBeNull();
  expect(within(card).getAllByTestId("oats-needs-choice")).toHaveLength(2);
  refuse = false;
  fireEvent.click(within(card).getAllByTestId("oats-needs-choice")[1]!);
  await waitFor(() => expect(within(card).queryAllByTestId("oats-needs-choice")).toEqual([]));
  expect(slot.inspection.sdkCalls.filter((call) => call.method === "threads.interactions.resolve").at(-1)!.args).toEqual([
    { threadId: "thr_ci", interactionId: "pint_3", resolution: { kind: "user_answer", answers: { q1: { selected: ["7"] } } } },
  ]);
});

test("a kind the plugin cannot answer in place keeps Open only", async () => {
  const slot = await homePage({
    sdk: { threads: { interactions: { list: async () => [{ id: "pint_4", threadId: "thr_ci", status: "pending", payload: { kind: "plugin", title: "A plugin's form", data: {} } }] as never } } },
  });
  const card = (await slot.findAllByTestId("oats-needs-card")).find((candidate) => candidate.dataset.instance === "flaky-ci-developer")!;
  await waitFor(() => expect(slot.inspection.sdkCalls).toHaveLength(1));
  expect(within(card).queryAllByTestId("oats-needs-choice")).toEqual([]);
  expect(within(card).queryByTestId("oats-needs-detail")).toBeNull();
  expect(within(card).getByTestId("oats-needs-open")).toBeTruthy();
  expect(within(card).getByTestId("oats-needs-question").textContent).toBe("needs your permission to use Bash");
});

test("each card has its own reply, named for its agent, and sends through bb's own send to that agent's thread", async () => {
  const slot = await homePage({ sdk: { threads: { ...NO_INTERACTIONS.threads, send: async () => ({ ok: true }) as never } } });
  const card = await cardOf(slot, "ranker-v3-probe");
  const text = within(card).getByLabelText("Reply to Ranker v3 probe") as HTMLTextAreaElement;
  expect(text.placeholder).toBe("Write to Ranker v3 probe…");
  const send = within(card).getByTestId("oats-reply-send") as HTMLButtonElement;
  expect(send.disabled).toBe(true);
  fireEvent.change(text, { target: { value: "  Use the darker palette.  " } });
  fireEvent.click(send);
  await waitFor(() => expect(text.value).toBe(""));
  expect(within(card).getByTestId("oats-reply-sent").textContent).toBe("Sent."); // on the card of the agent it went to: the card says to whom
  expect(slot.inspection.sdkCalls.filter((call) => call.method !== "threads.interactions.list")).toEqual([
    { method: "threads.send", args: [{ threadId: "thr_research", mode: "auto", input: [{ type: "text", text: "Use the darker palette.", mentions: [] }] }] },
  ]);
  // No reply stands apart from a card: every box is inside the card of the agent it writes to.
  for (const box of slot.getAllByTestId("oats-reply")) expect(box.closest('[data-testid="oats-needs-card"]')).not.toBeNull();
  expect(slot.inspection.rpcCalls.map((call) => call.method).filter((method) => !["snapshot", "souls", "capabilities", "teams", "machines", "automations", "homeCli"].includes(method))).toEqual([]); // reads only (the roster, the tiles' counts, the Automations tile's mark): never an OATS act
});

test("a failed send says why, on the card, and keeps the text", async () => {
  const slot = await homePage({
    sdk: {
      threads: {
        ...NO_INTERACTIONS.threads,
        send: async () => {
          throw new Error("thread is archived");
        },
      },
    },
  });
  const card = await cardOf(slot, "ranker-v3-probe");
  const text = within(card).getByTestId("oats-reply-text") as HTMLTextAreaElement;
  fireEvent.change(text, { target: { value: "hello" } });
  fireEvent.click(within(card).getByTestId("oats-reply-send"));
  const notice = await within(card).findByRole("alert");
  expect(notice.querySelector("h3")!.textContent).toBe("The message was not sent");
  expect(notice.textContent).toBe("The message was not sentthread is archived"); // why, in view, as the card's one line
  expect(within(notice).queryByTestId("oats-notice-details")).toBeNull();
  expect(text.value).toBe("hello");
});

test("with no roster ever read the page says what is missing in a person's words, the code after them, the kernel's message under Details, and Retry", async () => {
  const slot = await homePage({
    rpc: handlers({ snapshot: () => ({ ok: false, at: "t", code: "OATS_NOT_FOUND", message: "oats: not found on the host's PATH\nmore" }) }),
  });
  const notice = await slot.findByRole("alert");
  expect(notice.querySelector("h3")!.textContent).toBe("OATS is not installed on this machine");
  expect(notice.textContent).toContain("OATS_NOT_FOUND");
  expect(notice.querySelector("details")!.textContent).toContain("oats: not found on the host's PATH");
  expect(slot.getByRole("button", { name: "Retry" })).toBeTruthy();
  expect(slot.queryByTestId("oats-home-needs")).toBeNull();
});

const plainTab = async (options: RenderSlotOptions<Contract> = {}) => {
  const app = await loadApp();
  expect(app.tabs).toHaveLength(1);
  const tab = app.tabs[0]!;
  expect([tab.id, tab.context.kind, tab.availability]).toEqual(["home", "thread", "fixed"]);
  return renderSlot<ExperimentalThreadTabProps, Contract>(
    tab as { component: ComponentType<ExperimentalThreadTabProps> },
    { threadId: "thr_plain", environment: null } /* a thread that is no agent's: an agent's own thread shows the view a feature names for it */,
    { rpc: handlers(), sidebarThreads: sidebarThreads(), sdk: NO_INTERACTIONS, ...options },
  );
};

test("the tiles: the plugin's pages that are shown, each with its count, each leading to its page; no tile for the agents", async () => {
  const slot = await plainTab();
  expect(heading(await slot.findByTestId("oats-home-needs"))).toBe("Needs you3");
  expect(slot.queryByTestId("oats-tile-agents")).toBeNull();
  await waitFor(() => expect(slot.getByTestId("oats-tile-souls").textContent).toBe("Souls2"));
  expect(slot.getByTestId("oats-tile-capabilities").textContent).toBe("Capabilities1");
  expect(slot.getByTestId("oats-tile-teams").textContent).toBe("Teams1");
  expect(slot.getByTestId("oats-tile-machines").textContent).toBe("Machines1");
  fireEvent.click(slot.getByTestId("oats-tile-teams"));
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "teams" }]);
});

test('a tile says "Counting…" while its page is read and "Couldn\'t count" when that failed, and still leads to its page', async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const base = handlers();
  const slot = await plainTab({
    rpc: { ...base, teams: async (input) => (await held, base.teams(input)), machines: () => { throw new Error("OATS_TIMEOUT: oats did not answer"); } } as Handlers,
  });
  await slot.findByTestId("oats-home-needs");
  await waitFor(() => expect(slot.getByTestId("oats-tile-machines").textContent).toBe("MachinesCouldn't count"));
  expect(slot.getByTestId("oats-tile-teams").textContent).toBe("TeamsCounting…");
  release();
  await waitFor(() => expect(slot.getByTestId("oats-tile-teams").textContent).toBe("Teams1"));
  fireEvent.click(slot.getByTestId("oats-tile-machines"));
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "machines" }]);
});

test("a hidden tab does not read the four pages", async () => {
  const slot = await plainTab({ tabVisible: false });
  await slot.findByTestId("oats-home-needs");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(slot.inspection.rpcCalls.map((call) => call.method).sort().join(" ")).toBe("snapshot souls"); // souls: for the names only
});

test("when bb cannot list a thread's interactions, the card keeps the claim and Open", async () => {
  const slot = await homePage({ sdk: {} }); // the client throws at the call
  const cards = await slot.findAllByTestId("oats-needs-card");
  expect(cards).toHaveLength(3);
  const card = cards.find((candidate) => candidate.dataset.instance === "flaky-ci-developer")!;
  expect(within(card).getByTestId("oats-needs-question").textContent).toBe("needs your permission to use Bash");
  expect(within(card).getByTestId("oats-needs-open")).toBeTruthy();
});

test("a message being typed stays on its agent's card when the order changes, and goes to that agent", async () => {
  let agents = fixtureAgents().map((agent) => (agent.instance === "release-070-maintainer" ? { ...agent, waiting: null } : agent));
  const slot = await homePage({
    rpc: handlers({ snapshot: () => fixtureSnapshot(agents) }),
    sdk: { threads: { ...NO_INTERACTIONS.threads, send: async () => ({ ok: true }) as never } },
  });
  const card = await cardOf(slot, "ranker-v3-probe");
  fireEvent.change(within(card).getByTestId("oats-reply-text"), { target: { value: "yes, force-push it" } });
  // another agent now waits too
  agents = fixtureAgents();
  await slot.behavior.emitRealtime("oats/changed", { at: "2026-11-19T12:45:00.000Z" });
  await waitFor(() => expect(slot.getAllByTestId("oats-needs-card").map((each) => each.dataset.instance)).toContain("release-070-maintainer"));
  const still = await cardOf(slot, "ranker-v3-probe");
  expect((within(still).getByTestId("oats-reply-text") as HTMLTextAreaElement).value).toBe("yes, force-push it");
  expect((within(await cardOf(slot, "release-070-maintainer")).getByTestId("oats-reply-text") as HTMLTextAreaElement).value).toBe("");
  fireEvent.click(within(still).getByTestId("oats-reply-send"));
  await waitFor(() => expect(slot.inspection.sdkCalls.filter((call) => call.method === "threads.send")).toHaveLength(1));
  expect((slot.inspection.sdkCalls.find((call) => call.method === "threads.send")!.args[0] as { threadId: string }).threadId).toBe("thr_research");
});

test("when an agent stops needing the person its card, and its reply, leave", async () => {
  let agents = fixtureAgents();
  const slot = await homePage({ rpc: handlers({ snapshot: () => fixtureSnapshot(agents) }) });
  expect(await cardOf(slot, "release-070-maintainer")).toBeTruthy();
  agents = agents.filter((agent) => agent.instance !== "release-070-maintainer");
  await slot.behavior.emitRealtime("oats/changed", { at: "2026-11-19T12:46:00.000Z" });
  await waitFor(() => expect(slot.getAllByTestId("oats-needs-card").map((each) => each.dataset.instance)).not.toContain("release-070-maintainer"));
  expect(slot.getAllByTestId("oats-reply")).toHaveLength(slot.getAllByTestId("oats-needs-card").length);
});

test("a claim's age follows the clock while the view stays open and nothing changes in OATS", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"], now: Date.parse("2026-11-19T12:22:30.000Z") });
  try {
    const slot = await homePage();
    const card = (await slot.findAllByTestId("oats-needs-card"))[0]!;
    expect(within(card).getByTestId("oats-status-line").textContent).toBe("!under a minute"); // the mark, then how long: no word (the heading says it), no separator, and no clock time
    // The Automations tile's mark is the automations feature's own read, on that feature's own clock: not the home's.
    const homes = () => slot.inspection.rpcCalls.filter((call) => call.method !== "automations").length;
    const before = homes();
    await act(async () => {
      vi.advanceTimersByTime(18 * 60_000);
    });
    expect(within(slot.getAllByTestId("oats-needs-card")[0]!).getByTestId("oats-status-line").textContent).toBe("!18 min");
    expect(homes()).toBe(before); // the clock alone: no reread of the home's
  } finally {
    vi.useRealTimers();
  }
});

test("a kernel refusal of the snapshot: what happened in words; the kernel's code and message one press away, under Details", async () => {
  const slot = await homePage({
    rpc: handlers({ snapshot: () => ({ ok: false, at: "t", code: "E_WORKSPACE_INVALID", message: "oats-workspace.yaml: unknown key `foo`\nsee docs" }) }),
  });
  const notice = await slot.findByRole("alert");
  expect(notice.querySelector("h3")!.textContent).toBe("OATS could not read this deployment");
  // The notice's face is its title and Retry; the kernel's code leads its message under the one fold, closed.
  const fold = within(notice).getByTestId("oats-notice-details") as HTMLDetailsElement;
  expect(fold.open).toBe(false);
  expect(Array.from(fold.querySelectorAll("p")).map((line) => line.textContent)).toEqual(["E_WORKSPACE_INVALID: oats-workspace.yaml: unknown key `foo`", "see docs"]);
  expect(notice.textContent).toBe("OATS could not read this deployment▸DetailsE_WORKSPACE_INVALID: oats-workspace.yaml: unknown key `foo`see docsRetry");
});

test("while a message is being sent the box cannot be edited, so nothing typed meanwhile is lost", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const slot = await homePage({ sdk: { threads: { ...NO_INTERACTIONS.threads, send: async () => (await held, { ok: true }) as never } } });
  const card = await cardOf(slot, "ranker-v3-probe");
  const text = within(card).getByTestId("oats-reply-text") as HTMLTextAreaElement;
  fireEvent.change(text, { target: { value: "first" } });
  fireEvent.click(within(card).getByTestId("oats-reply-send"));
  await waitFor(() => expect(within(card).getByTestId("oats-reply-send").textContent).toBe("Sending…"));
  expect(text.disabled).toBe(true);
  release();
  await waitFor(() => expect(text.disabled).toBe(false));
  expect(text.value).toBe("");
});

test("an approval or a question with nothing else to say shows the interaction's own title", async () => {
  const agents = fixtureAgents().map((agent) => (agent.instance === "flaky-ci-developer" ? { ...agent, waiting: null } : agent));
  const slot = await homePage({
    rpc: handlers({}, agents),
    sdk: { threads: { interactions: { list: async () => [{ id: "p", threadId: "thr_ci", status: "pending", payload: { kind: "approval", title: "Approve the plan", reason: null } }] as never } } },
  });
  const card = (await slot.findAllByTestId("oats-needs-card")).find((candidate) => candidate.dataset.instance === "flaky-ci-developer")!;
  await waitFor(() => expect(within(card).getByTestId("oats-needs-question").textContent).toBe("Approve the plan"));
});

test("two choices with one label are both drawn and answer with their own values", async () => {
  const agents = fixtureAgents().map((agent) => (agent.instance === "flaky-ci-developer" ? { ...agent, waiting: null } : agent));
  const slot = await homePage({
    rpc: handlers({}, agents),
    sdk: {
      threads: {
        interactions: {
          list: async () =>
            [{ id: "p", threadId: "thr_ci", status: "pending", payload: { kind: "user_question", questions: [{ id: "q", prompt: "Which?", options: [{ label: "Same", value: "a" }, { label: "Same", value: "b" }] }] } }] as never,
          resolve: async () => ({}) as never,
        },
      },
    },
  });
  const card = (await slot.findAllByTestId("oats-needs-card")).find((candidate) => candidate.dataset.instance === "flaky-ci-developer")!;
  await waitFor(() => expect(within(card).getAllByTestId("oats-needs-choice")).toHaveLength(2));
  fireEvent.click(within(card).getAllByTestId("oats-needs-choice")[1]!);
  await waitFor(() => expect(slot.inspection.sdkCalls.some((call) => call.method === "threads.interactions.resolve")).toBe(true));
  expect(slot.inspection.sdkCalls.find((call) => call.method === "threads.interactions.resolve")!.args).toEqual([
    { threadId: "thr_ci", interactionId: "p", resolution: { kind: "user_answer", answers: { q: { selected: ["b"] } } } },
  ]);
});

test("on an agent's own thread the tab shows the view a feature named for one agent, and the home on any other thread", async () => {
  const app = await loadApp();
  const tab = app.tabs[0]! as { component: ComponentType<ExperimentalThreadTabProps> };
  const render = (threadId: string) =>
    renderSlot<ExperimentalThreadTabProps, Contract>(tab, { threadId, environment: null }, { rpc: handlers(), sidebarThreads: sidebarThreads(), sdk: NO_INTERACTIONS });
  setAgentTab(({ agent, threadId }) => <p data-testid="agent-view">{`${agent.instance} on ${threadId}`}</p>);
  try {
    const onAgent = render("thr_ci");
    expect((await onAgent.findByTestId("agent-view")).textContent).toBe("flaky-ci-developer on thr_ci");
    expect(onAgent.queryByTestId("oats-home-tab")).toBeNull();
    onAgent.unmount();
    // A thread that is no agent's keeps the home.
    const onPlain = render("thr_plain");
    expect(heading(await onPlain.findByTestId("oats-home-needs"))).toBe("Needs you3");
    expect(onPlain.queryByTestId("agent-view")).toBeNull();
  } finally {
    setAgentTab(null);
  }
});

test("while the roster cannot be read the tab keeps the view of the agent it showed there, not the home's error line", async () => {
  const app = await loadApp();
  const tab = app.tabs[0]! as { component: ComponentType<ExperimentalThreadTabProps> };
  let failing = false;
  const rpc = handlers({ snapshot: () => (failing ? { ok: false as const, at: "2026-11-19T12:35:00.000Z", code: "OATS_TIMEOUT", message: "oats did not answer" } : fixtureSnapshot()) });
  setAgentTab(({ agent, threadId }) => <p data-testid="agent-view">{`${agent.instance} on ${threadId}`}</p>);
  try {
    const first = renderSlot<ExperimentalThreadTabProps, Contract>(tab, { threadId: "thr_ci", environment: null }, { rpc, sidebarThreads: sidebarThreads(), sdk: NO_INTERACTIONS });
    expect((await first.findByTestId("agent-view")).textContent).toBe("flaky-ci-developer on thr_ci");
    first.unmount();
    // The read fails from now on: the same thread still shows the agent's view, with the agent as last read.
    failing = true;
    const later = renderSlot<ExperimentalThreadTabProps, Contract>(tab, { threadId: "thr_ci", environment: null }, { rpc, sidebarThreads: sidebarThreads(), sdk: NO_INTERACTIONS });
    expect((await later.findByTestId("agent-view")).textContent).toBe("flaky-ci-developer on thr_ci");
    await waitFor(() => expect(later.inspection.rpcCalls.some((call) => call.method === "snapshot")).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(later.queryByTestId("agent-view")).not.toBeNull();
    expect(later.queryByRole("alert")).toBeNull();
    later.unmount();
    // Once a roster is read that names no agent on that thread (it was retired), the tab forgets it:
    // the next failed read shows the home there, not the retired agent's view.
    failing = false;
    const without = { ...fixtureSnapshot(fixtureAgents().filter((agent) => agent.instance !== "flaky-ci-developer")), at: "2026-11-19T12:40:00.000Z" };
    const retired = renderSlot<ExperimentalThreadTabProps, Contract>(tab, { threadId: "thr_ci", environment: null }, { rpc: handlers({ snapshot: () => without }), sidebarThreads: sidebarThreads(), sdk: NO_INTERACTIONS });
    await retired.findByTestId("oats-home-needs");
    expect(retired.queryByTestId("agent-view")).toBeNull();
    retired.unmount();
    failing = true;
    const afterwards = renderSlot<ExperimentalThreadTabProps, Contract>(tab, { threadId: "thr_ci", environment: null }, { rpc, sidebarThreads: sidebarThreads(), sdk: NO_INTERACTIONS });
    expect((await afterwards.findByRole("alert")).textContent).toContain("oats did not answer");
    expect(afterwards.queryByTestId("agent-view")).toBeNull();
    afterwards.unmount();
    // A thread the tab never showed an agent on gets the home, with its failure said.
    const other = renderSlot<ExperimentalThreadTabProps, Contract>(tab, { threadId: "thr_research", environment: null }, { rpc, sidebarThreads: sidebarThreads(), sdk: NO_INTERACTIONS });
    expect((await other.findByRole("alert")).textContent).toContain("oats did not answer");
    expect(other.queryByTestId("agent-view")).toBeNull();
  } finally {
    setAgentTab(null);
  }
});

test("while OATS cannot be read after it was, the home keeps what it showed, under the same notice as the sidebar's, with its age", async () => {
  // A clock of its own: the age it asserts is of a time it names, not of however long the test took.
  const NOW = Date.parse("2026-11-20T10:00:00.000Z");
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  try {
    const last = { at: new Date(NOW - 2 * 60_000 - 5_000).toISOString(), deployment: { root: "/abs/deployment", workspace: "oats", machine: "falcon" }, agents: fixtureAgents() };
    const slot = await homePage({
      rpc: handlers({ snapshot: () => ({ ok: false, at: new Date(NOW).toISOString(), code: "OATS_TIMEOUT", message: "`oats` did not answer within 20 s and was stopped", last }) }),
    });
    const notice = await slot.findByRole("alert");
    expect(notice.querySelector("h3")!.textContent).toBe("OATS did not answer on falcon");
    // Its face: the title, the age in one form, that the acts are off, its one fold, Retry.
    expect(notice.textContent).toBe(`OATS did not answer on falconRead 2 min ago. Acts are off.▸Details${within(notice).getByTestId("oats-notice-details").querySelector("div")!.textContent}Retry`);
    expect(Array.from(within(notice).getByTestId("oats-notice-details").querySelectorAll("p")).map((line) => line.textContent)).toEqual(["It took more than 20 s.", "OATS_TIMEOUT: `oats` did not answer within 20 s and was stopped"]);
    expect(slot.getByTestId("oats-home-needs").textContent).toContain("Needs you");
    expect(slot.getAllByTestId("oats-needs-card").length).toBeGreaterThan(0);
  } finally {
    vi.useRealTimers();
  }
});

// ---- Home › Agents, the empty workspace, the agents with no bb thread, what is held while stale

const TMUX_ASKS: Agent = {
  ...fixtureAgents()[0]!,
  instance: "night-watch-helper",
  backend: "tmux",
  threadId: null,
  parent: null,
  human: "Ana",
  running: true,
  runtimeState: "running",
  waiting: { reason: "attention", message: "Which branch do I watch?", since: "2026-11-19T12:29:00.000Z" },
};

test("Home › Agents: every agent OATS has, in the sidebar's order, each with its state, the one count line, and the way back", async () => {
  const agents = [...fixtureAgents(), TMUX_ASKS];
  const slot = await homePage({ rpc: handlers({}, agents) });
  // The home draws no tile for the agents and nothing else that leads to Home › Agents: the view is reached by its address alone (below).
  await slot.findByTestId("oats-home-needs");
  expect(slot.queryByTestId("oats-tile-agents")).toBeNull();
  expect(slot.queryByTestId("oats-home-agents")).toBeNull();
  expect(slot.inspection.navigateCalls).toEqual([]);
  slot.unmount();

  const app = await loadApp();
  const panel = app.navPanels.find((candidate) => candidate.id === "home")!;
  const list = renderSlot<{ subPath: string }, Contract>(panel, { subPath: "agents" }, { rpc: handlers({}, agents), sidebarThreads: sidebarThreads(), sdk: NO_INTERACTIONS });
  const section = await list.findByTestId("oats-home-agents");
  expect(heading(section)).toBe(`Agents${agents.length}`); // the word of the tile that opened it
  // The one count line of the home, here: by state, every agent once; how many there are in all is the heading's count.
  const summary = within(section).getByTestId("oats-home-summary").textContent!;
  expect(summary).toMatch(/^\d+ running · 4 need you/);
  expect(summary).not.toMatch(/agents/);
  expect(summary.split(" · ").map((part) => Number(part.split(" ")[0])).reduce((sum, n) => sum + n, 0)).toBe(agents.length);
  const rows = within(section).getAllByTestId("oats-home-agent-row");
  // every agent, the stopped ones, the ones whose thread is gone and the ones on tmux among them
  expect(rows.map((row) => row.dataset.instance).sort()).toEqual(agents.map((agent) => agent.instance).sort());
  for (const row of rows) expect(within(row).getByTestId("oats-state").textContent).not.toBe("");
  // The word is the one function's, by backend (the lead's ruling T4): an agent on tmux that runs reads "Running", one on a bb thread with a turn running "Working".
  const stateOf = (instance: string) => within(rows.find((row) => row.dataset.instance === instance)!).getByTestId("oats-state").textContent;
  expect([stateOf("kernel-fix-developer"), stateOf("desktop-mockups-developer")]).toEqual(["Running", "Working"]);
  const tmux = rows.find((row) => row.dataset.instance === "night-watch-helper")!;
  expect(rows.indexOf(tmux)).toBeLessThan(rows.length - 1); // in the sidebar's one order: it waits, so it is among the first, not in a block after the tree
  expect(within(tmux).getByTestId("oats-home-agent").textContent).toBe("Night watch helper");
  // Beside its name, one line: no reason, its soul, where it is; its machine and who started it are on its page (the panel's Lineage).
  expect(within(tmux).getByTestId("oats-home-agent-where").textContent).toBe("oats-maintainer · tmux");
  expect(within(tmux).getByTestId("oats-home-agent-where").getAttribute("title")).toBe("oats-maintainer · tmux");
  expect(within(tmux).getByTestId("oats-home-agent-where").previousElementSibling).toBe(within(tmux).getByTestId("oats-home-agent")); // on the name's line, after the name
  expect(within(within(tmux).getByTestId("oats-home-agent-where")).getByTestId("oats-tmux").parentElement!.className.split(/\s+/)).toContain("shrink-0"); // the glyph is never pushed out
  expect(tmux.textContent).not.toMatch(/started by|Ana|falcon/);
  expect(within(tmux).getByTestId("oats-state").textContent).toContain("Needs you");
  // An agent on its bb thread: its soul alone, no reason and no glyph.
  expect(within(rows.find((row) => row.dataset.instance === "redesign-ui-lead")!).getByTestId("oats-home-agent-where").textContent).toBe("oats-product-expert");
  // no card and no reply here: the list says who there is
  expect(list.queryByTestId("oats-needs-card")).toBeNull();
  const back = list.getByTestId("oats-home-back");
  expect(back.textContent).toBe("‹ Home");
  expect(document.activeElement).toBe(back);
  fireEvent.click(back);
  expect(list.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "home" }]);
  // Esc, pressed in the list, returns too
  fireEvent.keyDown(within(tmux).getByTestId("oats-home-agent"), { key: "Escape" });
  expect(list.inspection.navigateCalls).toHaveLength(2);
  // and a key pressed elsewhere on the screen is not the list's
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(list.inspection.navigateCalls).toHaveLength(2);
});

test("in the thread's tab the home has no way to Home › Agents: no tile for the agents, and the tab stays the home; the page's address opens the view, and ‹ Home there leads back", async () => {
  const slot = await plainTab();
  expect(await slot.findByTestId("oats-home-needs")).toBeTruthy();
  expect(slot.queryByTestId("oats-tile-agents")).toBeNull();
  expect(slot.queryByTestId("oats-home-agents")).toBeNull();
  expect(slot.queryByTestId("oats-home-back")).toBeNull();
  slot.unmount();
  resetApp();
  // The view itself is there, at the page's address.
  const app = await loadApp();
  const panel = app.navPanels.find((candidate) => candidate.id === "home")!;
  const list = renderSlot<{ subPath: string }, Contract>(panel, { subPath: "agents" }, { rpc: handlers(), sidebarThreads: sidebarThreads(), sdk: NO_INTERACTIONS });
  expect(heading(await list.findByTestId("oats-home-agents"))).toBe(`Agents${fixtureAgents().length}`);
  expect(list.queryByTestId("oats-home-needs")).toBeNull();
  fireEvent.click(list.getByTestId("oats-home-back"));
  expect(list.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "home" }]);
});

test("an agent with no bb thread that needs the person has its card: what it asks, where to answer it in five words, Open to its own page, and no reply and no command", async () => {
  vi.useFakeTimers({ now: FOUR_DAYS_ON, toFake: ["Date"] }); // (the card's wait is pinned below: never the real clock)
  let opened: string | null = null;
  const { setAgentPage } = await import("../../app/home/agent-tab");
  const slot = await homePage({ rpc: handlers({}, [...fixtureAgents(), TMUX_ASKS]) });
  setAgentPage((_navigate, instance) => void (opened = instance));
  try {
    const card = await cardOf(slot, "night-watch-helper");
    expect(heading(slot.getByTestId("oats-home-needs"))).toBe("Needs you4");
    expect(within(card).getByTestId("oats-needs-question").textContent).toBe("Which branch do I watch?");
    // Its soul and where it runs are the card's second line; then where to answer it. The
    // kernel's command is not on the card: it is on the agent's page, where Open leads.
    expect(within(card).getByTestId("oats-needs-where").textContent).toBe("oats-maintainer · tmux");
    expect(within(card).getByTestId("oats-needs-elsewhere").textContent).toBe("Answer it in its terminal.");
    expect(card.textContent).toBe("Night watch helperoats-maintainer · tmux!4 dOpenWhich branch do I watch?Answer it in its terminal.");
    expect(card.textContent).not.toMatch(/oats session attach|falcon/);
    expect(within(card).queryByRole("button", { name: "Copy the command" })).toBeNull();
    expect(within(card).getByTestId("oats-needs-open").textContent).toBe("Open");
    expect(within(card).getByTestId("oats-needs-open").getAttribute("aria-label")).toBe("Open its page: Night watch helper");
    expect(within(card).queryByTestId("oats-reply")).toBeNull();
    expect(within(card).queryByTestId("oats-needs-message")).toBeNull();
    fireEvent.click(within(card).getByTestId("oats-needs-open"));
    expect(opened).toBe("night-watch-helper");
    expect(slot.inspection.navigateCalls).toEqual([]);
  } finally {
    setAgentPage(null);
  }
});

test("the newest claim comes first; more than eight show eight and then all on a press", async () => {
  const base = fixtureAgents()[0]!;
  const many: Agent[] = Array.from({ length: 10 }, (_unused, index) => ({
    ...base,
    instance: `asks-${index}-helper`,
    backend: "tmux",
    threadId: null,
    running: true,
    runtimeState: "running",
    waiting: { reason: "attention", message: `question ${index}`, since: `2026-11-19T12:${String(10 + index)}:00.000Z` },
  }));
  const slot = await homePage({ rpc: handlers({}, many), sidebarThreads: calm() });
  const needs = await slot.findByTestId("oats-home-needs");
  expect(heading(needs)).toBe("Needs you10");
  expect(within(needs).getAllByTestId("oats-needs-card").map((card) => card.dataset.instance)).toEqual([9, 8, 7, 6, 5, 4, 3, 2].map((index) => `asks-${index}-helper`));
  const more = within(needs).getByTestId("oats-home-needs-all");
  expect(more.textContent).toBe("Show all 10");
  fireEvent.click(more);
  expect(within(needs).getAllByTestId("oats-needs-card")).toHaveLength(10);
  expect(more.textContent).toBe("Show fewer");
});

test("more than five at work show five, then all on a press", async () => {
  const base = fixtureAgents()[0]!;
  const many: Agent[] = Array.from({ length: 7 }, (_unused, index) => ({ ...base, instance: `works-${index}-helper`, backend: "tmux", threadId: null, running: true, runtimeState: "running", waiting: null }));
  const slot = await homePage({ rpc: handlers({}, many), sidebarThreads: calm() });
  const working = await slot.findByTestId("oats-home-working");
  expect(heading(working)).toBe("Running7");
  expect(within(working).getAllByTestId("oats-working-row")).toHaveLength(5);
  fireEvent.click(within(working).getByTestId("oats-home-working-all"));
  expect(within(working).getAllByTestId("oats-working-row")).toHaveLength(7);
});

test("a workspace with no agent says so in three words, and New agent is the one act, first on the page", async () => {
  const slot = await homePage({ rpc: handlers({}, []), sidebarThreads: calm() });
  const empty = await slot.findByTestId("oats-empty");
  expect(empty.textContent).toBe("No agents yet."); // the sidebar's own words for it: one sentence for one thing
  // the one act of that home is New agent, first on the page, drawn as the thing to press
  expect(slot.getByTestId("oats-home-head").textContent).toBe("New agent");
  expect(slot.getByTestId("oats-home-head").compareDocumentPosition(empty) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(slot.queryByTestId("oats-home-needs")).toBeNull();
  expect(slot.queryByTestId("oats-home-summary")).toBeNull();
  fireEvent.click(slot.getByTestId("oats-home-new-agent"));
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "new-agent" }]); // the form's own page (app/spawn)
});

test("while what is shown is the roster as last read, a card's answers and its reply are held, and the page's one notice says why; Open still opens", async () => {
  const last = { at: new Date(Date.now() - 2 * 60_000 - 5_000).toISOString(), deployment: { root: "/abs/deployment", workspace: "oats", machine: "falcon" }, agents: fixtureAgents() };
  const slot = await homePage({
    rpc: handlers({ snapshot: () => ({ ok: false, at: new Date().toISOString(), code: "OATS_TIMEOUT", message: "`oats` did not answer within 20 s and was stopped", last }) }),
    sdk: {
      threads: {
        interactions: { list: async () => [{ id: "p", threadId: "thr_ci", status: "pending", payload: { kind: "provider-pi/extension-ui", title: "Confirm", data: { requestId: "r1", method: "confirm", fullTitle: "Force-push?" } } }] as never },
      },
    },
  });
  const card = await cardOf(slot, "flaky-ci-developer");
  await waitFor(() => expect(within(card).getAllByTestId("oats-needs-choice")).toHaveLength(2));
  for (const choice of within(card).getAllByTestId("oats-needs-choice")) expect((choice as HTMLButtonElement).disabled).toBe(true);
  // No card says why by itself: the notice over the cards, on the same screen, says that the acts are off, with Retry.
  expect(within(card).queryByTestId("oats-disabled-reason")).toBeNull();
  // a card answered by a reply holds it too
  const asks = await cardOf(slot, "ranker-v3-probe");
  expect((within(asks).getByTestId("oats-reply-text") as HTMLTextAreaElement).disabled).toBe(true);
  expect((within(asks).getByTestId("oats-reply-send") as HTMLButtonElement).disabled).toBe(true);
  expect(within(asks).queryByTestId("oats-disabled-reason")).toBeNull();
  expect(slot.getByTestId("oats-home-page").textContent).not.toContain("Held until OATS is read again");
  expect((within(card).getByTestId("oats-needs-open") as HTMLButtonElement).disabled).toBe(false);
  // the one notice of the roster's, once, before the cards it holds
  expect(slot.getAllByRole("alert")).toHaveLength(1);
  expect(within(slot.getByRole("alert")).getByTestId("oats-held").textContent).toBe("Acts are off.");
  expect(within(slot.getByRole("alert")).getByRole("button", { name: "Retry" })).toBeTruthy();
  expect(slot.getByRole("alert").compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("a page's tile carries the mark its feature gives it: Automations while a run failed", async () => {
  const { addPageLink } = await import("../../app/workspace/pages");
  const remove = addPageLink({ path: "automations", title: "Automations", useMark: () => ({ label: "Automations, a run failed" }) });
  try {
    const slot = await plainTab();
    const tile = await slot.findByTestId("oats-tile-automations");
    expect(within(tile).getByLabelText("Automations, a run failed")).toBeTruthy();
    expect(tile.textContent).toBe("Automations"); // no count of its own
  } finally {
    remove();
  }
});

// ---- the installed oats against what the plugin is built for; the pages this release shows

const withCli = (cli: { version: string | null; desktopApi: number | null; state: "older" | "tested" | "newer" | "newer-api" | "unknown" }, agents: Agent[] = fixtureAgents()) =>
  homePage({ rpc: { ...handlers({}, agents), homeCli: () => cli } as Handlers });

test("a tested oats says nothing", async () => {
  const tested = await homePage();
  await tested.findByTestId("oats-home-needs");
  await waitFor(() => expect(tested.inspection.rpcCalls.some((call) => call.method === "homeCli")).toBe(true));
  expect(tested.queryByTestId("oats-home-cli")).toBeNull();
  expect(tested.queryByTestId("oats-home-cli-line")).toBeNull();
  expect(tested.queryByTestId("oats-home-cli-unchecked")).toBeNull();
});

test("a first version read that fails: the home tries once more by itself once the roster is read; still failing, it says nothing (nothing is off) and New agent stays on", async () => {
  let failing = true;
  const slot = await homePage({
    rpc: {
      ...handlers(),
      homeCli: () => {
        if (failing) throw new Error("OATS_TIMEOUT: oats did not answer");
        return { version: "0.70.5", desktopApi: 1, state: "tested" as const };
      },
    } as Handlers,
  });
  await slot.findByTestId("oats-home-needs");
  const asked = () => slot.inspection.rpcCalls.filter((call) => call.method === "homeCli").length;
  // it failed, and was tried once more, by itself, and no more than that
  await waitFor(() => expect(asked()).toBe(2));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(asked()).toBe(2);
  // The roster reads, so `oats` runs, and no act is turned off: the home says nothing of it, in a line or a card.
  expect(slot.queryByTestId("oats-home-cli-unchecked")).toBeNull();
  expect(slot.queryByTestId("oats-home-cli-retry")).toBeNull();
  expect(slot.getByTestId("oats-home-page").textContent).not.toMatch(/could not be checked|Check again/);
  // not drawn as a failure of the roster's, and the act that makes an agent is not turned off for it
  expect(slot.queryByRole("alert")).toBeNull();
  expect(slot.queryByTestId("oats-home-cli")).toBeNull();
  expect((slot.getByTestId("oats-home-new-agent") as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(slot.getByTestId("oats-home-new-agent"));
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "new-agent" }]);
  failing = false; // (kept for the handler above: nothing on the page asks again)
});

test("a first version read that fails and answers at the home's own second try says nothing", async () => {
  let calls = 0;
  const slot = await homePage({
    rpc: {
      ...handlers(),
      homeCli: () => {
        calls += 1;
        if (calls === 1) throw new Error("OATS_TIMEOUT: oats did not answer");
        return { version: "0.69.4", desktopApi: 1, state: "older" as const };
      },
    } as Handlers,
  });
  // the second try answered: what it read is shown as any answer is
  expect((await slot.findByTestId("oats-home-cli")).querySelector("h3")!.textContent).toBe("Compatible oats CLI required");
  expect(calls).toBe(2);
  expect(slot.queryByTestId("oats-home-cli-unchecked")).toBeNull();
});

test("an oats older than the plugin works with: the card says what was detected, what is required and the command to copy", async () => {
  const slot = await withCli({ version: "0.69.4", desktopApi: 1, state: "older" });
  const card = await slot.findByTestId("oats-home-cli");
  expect(card.querySelector("h3")!.textContent).toBe("Compatible oats CLI required");
  // The card's face, whole: no sentence on how the plugin works; what was detected, what is required, the command, its two acts.
  expect(card.textContent).toBe(`Compatible oats CLI requiredDetected0.69.4Required${OATS_FLOOR} or newernpm install -g @awebai/oats@0.70CopyCheck again`);
  expect(within(card).getAllByTestId("oats-fact").map((fact) => fact.textContent)).toEqual(["Detected0.69.4", `Required${OATS_FLOOR} or newer`]);
  expect(card.querySelector("code")!.textContent).toBe("npm install -g @awebai/oats@0.70");
  expect(within(card).getByRole("button", { name: "Copy install command" })).toBeTruthy();
  // the card comes before what needs the person, and the roster is still drawn
  expect(card.compareDocumentPosition(slot.getByTestId("oats-home-needs")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("an oats whose version cannot be read gets the same card, and says \"unknown\"", async () => {
  const slot = await withCli({ version: null, desktopApi: null, state: "unknown" });
  const card = await slot.findByTestId("oats-home-cli");
  expect(card.querySelector("h3")!.textContent).toBe("Compatible oats CLI required");
  expect(within(card).getAllByTestId("oats-fact")[0]!.textContent).toBe("Detectedunknown");
});

test("an oats that speaks a newer desktop API: the card names the plugin as the older one and offers no npm command", async () => {
  const slot = await withCli({ version: "0.74.0", desktopApi: 2, state: "newer-api" });
  const card = await slot.findByTestId("oats-home-cli");
  expect(card.querySelector("h3")!.textContent).toBe("This plugin is older than the installed oats CLI");
  expect(card.textContent).toBe("This plugin is older than the installed oats CLIUpdate the OATS plugin.Detected0.74.0Check again"); // what to do, in four words
  // The floor is not the bound that is broken here: no "Required <floor> or newer" beside a version that IS newer (it denied the title).
  expect(within(card).getAllByTestId("oats-fact").map((fact) => fact.textContent)).toEqual(["Detected0.74.0"]);
  expect(card.querySelector("code")).toBeNull();
  expect(card.textContent).not.toContain("npm");
  // no command to copy: the one thing to press asks again, after the plugin was updated
  expect(within(card).getAllByRole("button").map((button) => button.textContent)).toEqual(["Check again"]);
});

test("an oats of a later minor than the plugin was tested with: no line, no card, and nothing is turned off", async () => {
  const slot = await withCli({ version: "0.71.2", desktopApi: 1, state: "newer" }, []);
  await slot.findByTestId("oats-empty");
  await waitFor(() => expect(slot.inspection.rpcCalls.some((call) => call.method === "homeCli")).toBe(true));
  await new Promise((resolve) => setTimeout(resolve, 0));
  // No act is turned off for it, so nothing is said of it.
  expect(slot.queryByTestId("oats-home-cli-line")).toBeNull();
  expect(slot.getByTestId("oats-home-page").textContent).not.toMatch(/tested with|0\.71\.2|Check again/);
  expect(slot.queryByTestId("oats-home-cli")).toBeNull();
  expect((slot.getByTestId("oats-home-new-agent") as HTMLButtonElement).disabled).toBe(false);
});

test("behind the card New agent is off, and the card on the same screen says why: on the home and on Home › Agents", async () => {
  const slot = await withCli({ version: "0.69.4", desktopApi: 1, state: "older" }, []);
  await slot.findByTestId("oats-home-cli");
  const button = slot.getByTestId("oats-home-new-agent") as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  // No reason stands beside the button, in words or in a title: the card under it is why, with what to do.
  expect(slot.queryByTestId("oats-disabled-reason")).toBeNull();
  expect(button.title).toBe("");
  expect(slot.getByTestId("oats-home-page").textContent).not.toContain("Off until a compatible oats CLI is installed.");
  expect(slot.getByTestId("oats-home-cli").querySelector("h3")!.textContent).toBe("Compatible oats CLI required");
  fireEvent.click(button);
  expect(slot.inspection.navigateCalls).toEqual([]);
  slot.unmount();
  // Home › Agents has the button too: off there, with the same card on that screen. Never off alone.
  const app = await loadApp();
  const panel = app.navPanels.find((candidate) => candidate.id === "home")!;
  const list = renderSlot<{ subPath: string }, Contract>(panel, { subPath: "agents" }, { rpc: { ...handlers(), homeCli: () => ({ version: "0.69.4", desktopApi: 1, state: "older" as const }) } as Handlers, sidebarThreads: sidebarThreads(), sdk: NO_INTERACTIONS });
  const card = await list.findByTestId("oats-home-cli");
  expect((list.getByTestId("oats-home-new-agent") as HTMLButtonElement).disabled).toBe(true);
  expect(card.querySelector("h3")!.textContent).toBe("Compatible oats CLI required");
  expect(list.getByTestId("oats-home-agents")).toBeTruthy();
});

test("the release's default shows the home alone: no tile at all, no count read for a page that is not shown, and New agent, which opens the form", async () => {
  const slot = await homePage({ settings: { pages: "home" } });
  await slot.findByTestId("oats-home-needs");
  expect(slot.queryByTestId("oats-home-tiles")).toBeNull(); // no page is shown, and the agents have no tile: nothing is drawn, not an empty list
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(slot.inspection.rpcCalls.map((call) => call.method).filter((method) => ["capabilities", "teams", "machines"].includes(method))).toEqual([]);
  slot.unmount();
  const some = await homePage({ settings: { pages: "home, teams" } });
  await some.findByTestId("oats-home-needs");
  expect(Array.from(some.getByTestId("oats-home-tiles").querySelectorAll("button")).map((tile) => tile.dataset.testid)).toEqual(["oats-tile-teams"]);
  some.unmount();
  const empty = await homePage({ rpc: handlers({}, []), sidebarThreads: calm(), settings: { pages: "home" } });
  await empty.findByTestId("oats-empty");
  // The way to start an agent survives the hidden pages: the form is a page of its own (app/spawn), not one a release leaves out.
  fireEvent.click(empty.getByTestId("oats-home-new-agent"));
  expect(empty.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "new-agent" }]);
});

test("Home › Agents says where an agent the roster draws on no thread is, from the one answer the sidebar reads, as the reason before its soul: nothing of an archived thread for a stop, the reason otherwise, and a lost tmux session", async () => {
  const threads = (...gone: string[]) => { const all = sidebarThreads(); return { ...all, threads: all.threads.filter((thread) => !gone.includes(thread.id)) }; };
  /** bb's own answer for the ids asked: the archived ones among them. */
  const bb = (...archived: string[]) => ({ threads: { list: async ({ threadIds }: { threadIds: readonly string[] }) => threadIds.filter((id) => archived.includes(id)).map((id) => ({ id, archivedAt: 1 })), interactions: { list: async () => [] } } }) as never as RenderSlotOptions<Contract>["sdk"];
  const app = await loadApp();
  const panel = app.navPanels.find((candidate) => candidate.id === "home")!;
  const rowOf = async (agents: Agent[], instance: string, options: Pick<RenderSlotOptions<Contract>, "sidebarThreads" | "sdk">) => {
    const list = renderSlot<{ subPath: string }, Contract>(panel, { subPath: "agents" }, { rpc: handlers({}, agents), ...options });
    const row = (await within(await list.findByTestId("oats-home-agents")).findAllByTestId("oats-home-agent-row")).find((each) => each.dataset.instance === instance)!;
    return { list, row, words: () => row.querySelector('[data-testid="oats-home-agent-where"]')?.textContent ?? "" }; // (the reason alone: no soul and no machine on the row)
  };
  const DIGEST = "weekly-digest-helper"; // the sample's agent OATS stopped, on thr_digest
  const withEnd = (sessionEnd: string) => fixtureAgents().map((agent): Agent => (agent.instance === DIGEST ? { ...agent, sessionEnd } : agent));
  // An operator's stop whose thread bb has archived: nothing of the thread (on a provider that archives at stop that is every stopped agent), and a press opens the archived thread.
  const stopped = await rowOf(withEnd("stopped"), DIGEST, { sidebarThreads: threads("thr_digest"), sdk: bb("thr_digest") });
  await waitFor(() => expect(stopped.list.inspection.sdkCalls.some((call) => call.method === "threads.list")).toBe(true));
  await new Promise((resolve) => setTimeout(resolve, 20)); // (time for a reason to be drawn, if one were)
  expect(stopped.words()).not.toMatch(/thread|archived|gone/);
  fireEvent.click(within(stopped.row).getByTestId("oats-home-agent"));
  await waitFor(() => expect(stopped.list.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: "thr_digest" }));
  stopped.list.unmount();
  resetApp();
  // A session lost with its thread archived: the reason, as on the sidebar's row: that it may still run.
  const lost = await rowOf(withEnd("lost"), DIGEST, { sidebarThreads: threads("thr_digest"), sdk: bb("thr_digest") });
  await waitFor(() => expect(lost.words()).toBe("oats-expert · may still run"));
  lost.list.unmount();
  resetApp();
  // bb answers that it has no thread of that id: deleted.
  const deleted = await rowOf(withEnd("stopped"), DIGEST, { sidebarThreads: threads("thr_digest"), sdk: bb() });
  await waitFor(() => expect(deleted.words()).toBe("oats-expert · deleted in bb"));
  expect(deleted.words()).not.toContain("gone");
  deleted.list.unmount();
  resetApp();
  // An agent on tmux whose session was lost: on a ROW its state's word is "Lost" (the row's end), so its line holds no reason: its soul, then where it runs; the title keeps "session lost".
  const tmuxLost: Agent = { ...TMUX_ASKS, waiting: null, running: false, runtimeState: null, sessionEnd: "lost" };
  const tmux = await rowOf([...fixtureAgents(), tmuxLost], tmuxLost.instance, { sidebarThreads: sidebarThreads(), sdk: bb() });
  await waitFor(() => expect(tmux.words()).toBe("oats-maintainer · tmux"));
  // One line beside the name, in the row's one order: the soul, then where it is (bb's terminal glyph; the word here: the test SDK's icon set has no glyph).
  const facts = within(tmux.row).getByTestId("oats-home-agent-where");
  expect(facts.previousElementSibling).toBe(within(tmux.row).getByTestId("oats-home-agent"));
  expect(Array.from(facts.querySelectorAll("[data-phrase]")).map((part) => [part.getAttribute("data-phrase"), part.className.split(/\s+/).includes("shrink-0")])).toEqual([["soul", false], ["where", true]]); // with no reason on the line the soul is the part that gives way; the glyph never (test/app/row-facts.test.tsx)
  expect(facts.getAttribute("title")).toBe("oats-maintainer · session lost · tmux");
  // Its state, at the row's end: the word "Lost", said once on the row, on the mark of a stopped agent (it IS stopped).
  expect([within(tmux.row).getByTestId("oats-state").textContent, within(tmux.row).getByTestId("oats-state").getAttribute("data-state")]).toEqual(["Lost", "stopped"]);
});

test("the card of an agent that asks and that bb lists no thread of says what became of its thread as the reason before its soul, as far as bb's answer goes, with no sentence; its Open leads to its page, or to the archived thread", async () => {
  const CI = "flaky-ci-developer"; // the sample's agent that asks (it carries a claim), on thr_ci
  const without = () => { const all = sidebarThreads(); return { ...all, threads: all.threads.filter((thread) => thread.id !== "thr_ci") }; };
  const bb = (...archived: string[]) => ({ threads: { list: async ({ threadIds }: { threadIds: readonly string[] }) => threadIds.filter((id) => archived.includes(id)).map((id) => ({ id, archivedAt: 1 })), interactions: { list: async () => [] } } }) as never as RenderSlotOptions<Contract>["sdk"];
  const cardOn = async (agents: Agent[], sdk: RenderSlotOptions<Contract>["sdk"]) => {
    const slot = await homePage({ rpc: handlers({}, agents), sidebarThreads: without(), sdk });
    const card = await cardOf(slot, CI);
    return { slot, card, where: () => within(card).queryByTestId("oats-needs-where")?.textContent ?? "", leads: () => within(card).getByTestId("oats-needs-open").getAttribute("aria-label") };
  };
  const quiet = (card: HTMLElement) => {
    // No sentence on where to answer, no reply: the reason is the card's second line, and Open is the way.
    expect(within(card).queryByTestId("oats-needs-elsewhere")).toBeNull();
    expect(within(card).queryByTestId("oats-reply")).toBeNull();
    expect(card.textContent).not.toMatch(/so nothing can be sent|Open its page shows|gone/);
    expect(within(card).getByTestId("oats-needs-open").textContent).toBe("Open");
  };
  // bb answers that it has no thread of that id: deleted. The button leads to its page.
  const deleted = await cardOn(fixtureAgents(), bb());
  await waitFor(() => expect(deleted.where()).toBe("oats-developer · deleted in bb"));
  quiet(deleted.card);
  expect(deleted.leads()).toBe("Open its page: Flaky ci developer");
  deleted.slot.unmount();
  resetApp();
  // bb has it archived (and the agent still runs): the button leads to the archived thread, and its name says so.
  const archived = await cardOn(fixtureAgents(), bb("thr_ci"));
  await waitFor(() => expect(archived.where()).toBe("oats-developer · may still run")); // (the reason of its row: it runs, and bb has its thread archived)
  quiet(archived.card);
  expect(archived.leads()).toBe("Open thread: Flaky ci developer");
  fireEvent.click(within(archived.card).getByTestId("oats-needs-open"));
  expect(archived.slot.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: "thr_ci" });
  archived.slot.unmount();
  resetApp();
  // Its row names no thread at all: "no bb thread"; the button leads to its page.
  const none = await cardOn(fixtureAgents().map((agent): Agent => (agent.instance === CI ? { ...agent, threadId: null } : agent)), bb());
  await waitFor(() => expect(none.where()).toBe("oats-developer · no bb thread"));
  quiet(none.card);
  expect(none.leads()).toBe("Open its page: Flaky ci developer");
});

test("the home's count of who needs you is the sidebar's: an agent on tmux that asks is in the badge, the heading and, on Home › Agents, the count line", async () => {
  const agents = [...fixtureAgents(), TMUX_ASKS];
  const latest = await badge({ rpc: handlers({}, agents) });
  await waitFor(() => expect(latest()).toEqual({ count: 4, tone: "warning", label: "4 agents need you" }));
  const slot = await homePage({ rpc: handlers({}, agents) });
  expect(heading(await slot.findByTestId("oats-home-needs"))).toBe("Needs you4");
  expect((await agentsLine(agents)).split(" · ")).toContain("4 need you");
});

test("an agent that runs outside OATS is one of those that need you, in every place by one number: the badge, the heading, the count line of Home › Agents; its card says so on its line, with Stop… and Start… as the line's acts and Details under it (no box), and no choice and no reply", async () => {
  // OATS recorded it stopped and the kernel reports its harness running (`outsideOats`; app/outside).
  const report = { code: "running-outside-oats" as const, backend: "bb", message: "a harness runs in weekly-digest-helper on bb, and OATS recorded this instance stopped: stop it with `oats instance stop weekly-digest-helper`, or start it from OATS" };
  const agents = fixtureAgents().map((agent): Agent => (agent.instance === "weekly-digest-helper" ? { ...agent, sessionEnd: "stopped", outsideOats: report } : agent));
  const before = await badge({ rpc: handlers({}, fixtureAgents()) });
  let n = 0;
  await waitFor(() => {
    const now = before();
    expect(now === null || now === "unset").toBe(false);
    n = (now as ExperimentalBadge).count as number;
  });
  resetApp();
  const latest = await badge({ rpc: handlers({}, agents) });
  await waitFor(() => expect(latest()).toMatchObject({ count: n + 1, tone: "warning" }));
  const slot = await homePage({ rpc: handlers({}, agents) });
  expect(heading(await slot.findByTestId("oats-home-needs"))).toBe(`Needs you${n + 1}`);
  const summary = await agentsLine(agents);
  expect(summary.split(" · ")).toContain(`${n + 1} need you`);
  expect(summary).not.toMatch(/outside/i); // counted once, among those that need you
  const card = await cardOf(slot, "weekly-digest-helper");
  expect(offerOf(card)).toBe("outside");
  expect(within(card).getByTestId("oats-state").textContent).toBe("Running outside OATS");
  // The same drawing as under the thread's line: the acts on the line, and ONE fold under it; no box, no title that repeats the line.
  const notice = within(card).getByTestId("oats-outside-warning");
  expect(within(card).queryByTestId("oats-notice")).toBeNull();
  expect(card.textContent).not.toContain("is running in bb, but OATS recorded it as stopped");
  expect(within(notice).getByTestId("oats-outside-details").querySelector("summary")!.textContent).toBe("▸Details");
  expect(notice.querySelectorAll("button")).toHaveLength(0);
  expect(Array.from(within(card).getByTestId("oats-status-line").querySelectorAll("button")).map((button) => button.textContent)).toEqual(["Stop…", "Start…"]); // (the dots: each opens its dialog)
  // The card is under "Needs you" and asks no question: it says, in the words of its line, what it needs; and Stop… is the primary act of the two.
  expect(within(within(card).getByTestId("oats-status-line")).getByTestId("oats-status-part").textContent).toMatch(/stopped in OATS$/);
  expect(within(card).getByTestId("oats-needs-outside").textContent).toBe("Stop, then Start.");
  expect(Array.from(card.querySelectorAll("button[data-primary]")).map((button) => button.textContent)).toEqual(["Stop…"]);
  for (const id of ["oats-needs-choice", "oats-reply-send", "oats-needs-stopped", "oats-needs-message"]) expect(within(card).queryByTestId(id)).toBeNull();
  const { asked } = await import("../../app/lifecycle");
  fireEvent.click(within(card).getByRole("button", { name: "Stop…" }));
  expect(asked()).toEqual({ verb: "stop", instance: "weekly-digest-helper" });
  resetApp();
  // An agent of another session provider has Stop alone: its card says no "Stop, then Start." (nobody reads Start with nothing to press).
  const others = fixtureAgents().map((agent): Agent => (agent.instance === "weekly-digest-helper" ? { ...agent, backend: "other", sessionEnd: "stopped", outsideOats: { ...report, backend: "other" } } : agent));
  const elsewhere = await homePage({ rpc: handlers({}, others) });
  const otherCard = await cardOf(elsewhere, "weekly-digest-helper");
  expect(offerOf(otherCard)).toBe("outside");
  expect(Array.from(within(otherCard).getByTestId("oats-status-line").querySelectorAll("button")).map((button) => button.textContent)).toEqual(["Stop…"]);
  expect(within(otherCard).queryByTestId("oats-needs-outside")).toBeNull();
  expect(otherCard.textContent).not.toMatch(/then Start/);
});

// The lead's T2 (24 Nov 2026): the pilot's first home is eight tmux agents whose sessions were lost, and nobody asking.
// The home had no place for them. ONE quiet section, only when it has rows: the roster's own word and their count
// ("Lost 8"), one line each (name · soul · glyph) with Start…: eight presses in one list, not eight pages.
test("THE PILOT'S FIRST HOME: eight tmux agents whose sessions were lost, nobody asking: \"Nothing needs you.\", then \"Lost 8\": one line each (name · soul · glyph) with Start…, which opens that agent's Start dialog", async () => {
  const names = ["birch", "cedar", "elm", "fir", "hazel", "larch", "oak", "pine"].map((tree) => `${tree}-developer`);
  const lostOnTmux = (instance: string): Agent => ({ ...TMUX_ASKS, instance, home: TMUX_ASKS.home.replace(TMUX_ASKS.instance, instance), alias: instance, waiting: null, running: false, runtimeState: null, sessionEnd: "lost" });
  const slot = await homePage({ rpc: handlers({}, names.map(lostOnTmux)), sidebarThreads: { ...sidebarThreads(), threads: [] } });
  const section = await slot.findByTestId("oats-home-lost");
  expect(heading(section)).toBe("Lost8");
  expect(slot.getByTestId("oats-home-nothing").textContent).toBe("Nothing needs you.");
  const rows = within(section).getAllByTestId("oats-lost-row");
  expect(rows.map((row) => row.getAttribute("data-instance"))).toEqual(names); // the roster's order
  // One line each: the name (the way to its page), its soul, where it runs; no reason (the heading says it) and no state word; then the one act.
  expect(rows.map((row) => [within(row).getByTestId("oats-home-agent").textContent, within(row).getByTestId("oats-home-agent-where").textContent, Array.from(row.querySelectorAll("button")).map((button) => button.textContent).at(-1)])).toEqual(names.map((name) => [`${name[0]!.toUpperCase()}${name.slice(1).replace("-", " ")}`, "oats-maintainer · tmux", "Start…"]));
  expect(section.textContent).not.toMatch(/session lost|Stopped/);
  expect(within(section).queryAllByTestId("oats-state")).toHaveLength(0);
  // Start… opens the act's dialog for THAT agent: nothing is started on the press.
  const { asked } = await import("../../app/lifecycle");
  fireEvent.click(within(rows[2]!).getByTestId("oats-lost-start"));
  expect(asked()).toEqual({ verb: "start", instance: "elm-developer" });
});

// ONE rule with the thread's line (ruled with the lead's T5): where a MESSAGE is the way on (a lost agent on bb whose
// thread bb lists), the row's act is Open: it opens that thread. Start… there would begin a NEW conversation where a
// message keeps the old one. Every other lost row has Start…: an agent on tmux (the pilot's eight).
test("the Lost list's act, by kind: a lost agent on bb whose thread bb lists has Open, which opens its thread and starts nothing; a lost agent on tmux has Start…", async () => {
  const lostOnBb = fixtureAgents().map((agent) => (agent.instance === "flaky-ci-developer" ? { ...agent, waiting: null, running: false as const, runtimeState: "stopped", sessionEnd: "lost" } : agent));
  const lostOnTmux: Agent = { ...TMUX_ASKS, waiting: null, running: false, runtimeState: null, sessionEnd: "lost" };
  const threads = sidebarThreads();
  // (bb's row of its thread is at rest: the agent's word is the roster's, "Lost".)
  const slot = await homePage({ rpc: handlers({}, [...lostOnBb, lostOnTmux]), sidebarThreads: { ...threads, threads: threads.threads.map((thread) => (thread.id === "thr_ci" ? { ...thread, status: "idle" as const, hasPendingInteraction: false } : thread)) } });
  const section = await slot.findByTestId("oats-home-lost");
  const row = (instance: string) => within(section).getAllByTestId("oats-lost-row").find((each) => each.getAttribute("data-instance") === instance)!;
  const acts = (instance: string) => Array.from(row(instance).querySelectorAll("button")).map((button) => button.textContent).slice(-1);
  expect(within(section).getAllByTestId("oats-lost-row").map((each) => each.getAttribute("data-instance"))).toEqual(["flaky-ci-developer", lostOnTmux.instance]);
  expect([acts("flaky-ci-developer"), acts(lostOnTmux.instance)]).toEqual([["Open"], ["Start…"]]);
  expect([within(row("flaky-ci-developer")).queryByTestId("oats-lost-start"), within(row(lostOnTmux.instance)).queryByTestId("oats-lost-open")]).toEqual([null, null]);
  const { asked } = await import("../../app/lifecycle");
  fireEvent.click(within(row("flaky-ci-developer")).getByTestId("oats-lost-open"));
  expect(asked()).toBeNull(); // no dialog: nothing is started
  await waitFor(() => expect(slot.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: "thr_ci" }));
});

test("the Lost section holds the agents whose roster row says \"Lost\", and no other: not one a person stopped; with none lost there is no section; over a roster that is the last one read its Start… is off", async () => {
  // The sample's roster: nobody's session was lost.
  const none = await homePage();
  await none.findByTestId("oats-home-needs");
  expect(none.queryByTestId("oats-home-lost")).toBeNull();
  none.unmount();
  resetApp();
  // One lost on tmux, one a person stopped on tmux: only the first is listed.
  const lostOne: Agent = { ...TMUX_ASKS, waiting: null, running: false, runtimeState: null, sessionEnd: "lost" };
  const stoppedOne: Agent = { ...TMUX_ASKS, instance: "day-watch-helper", home: TMUX_ASKS.home.replace(TMUX_ASKS.instance, "day-watch-helper"), alias: "day-watch-helper", waiting: null, running: false, runtimeState: "stopped", sessionEnd: "operator" };
  const agents = [...fixtureAgents(), lostOne, stoppedOne];
  const slot = await homePage({ rpc: handlers({}, agents) });
  const section = await slot.findByTestId("oats-home-lost");
  expect([heading(section), within(section).getAllByTestId("oats-lost-row").map((row) => row.getAttribute("data-instance"))]).toEqual(["Lost1", [lostOne.instance]]);
  expect((within(section).getByTestId("oats-lost-start") as HTMLButtonElement).disabled).toBe(false);
  slot.unmount();
  resetApp();
  // Behind a result that says it started, until the roster is read again: the row is still in the list (the roster is
  // from before), and its Start… is off: a second press would start what the result says is started (L13's rule).
  const { noteActed, forgetActed } = await import("../../app/roster/reading");
  const again = await homePage({ rpc: handlers({}, agents) });
  const live = (await again.findByTestId("oats-lost-start")) as HTMLButtonElement;
  expect(live.disabled).toBe(false);
  const { act: settle } = await import("@testing-library/react");
  settle(() => noteActed([lostOne.instance], fixtureSnapshot(agents).at));
  expect((again.getByTestId("oats-lost-start") as HTMLButtonElement).disabled).toBe(true);
  // Off, and not alone: the row says "Reading…" in its facts' place.
  const row = again.getByTestId("oats-lost-start").closest('[data-testid="oats-lost-row"]') as HTMLElement;
  expect([within(row).getByTestId("oats-lost-reading").textContent, within(row).queryByTestId("oats-home-agent-where")]).toEqual(["Reading…", null]);
  forgetActed();
  again.unmount();
  resetApp();
  // The roster shown is the last one read: the acts are off, this one too (the notice on the same screen says so).
  const last = { at: new Date(Date.now() - 120_000).toISOString(), deployment: { root: "/abs/deployment", workspace: "oats", machine: "falcon" }, agents };
  const stale = await homePage({ rpc: handlers({ snapshot: () => ({ ok: false, at: new Date().toISOString(), code: "OATS_TIMEOUT", message: "`oats` did not answer within 20 s and was stopped", last }) }) });
  const held = await stale.findByTestId("oats-lost-start");
  expect((held as HTMLButtonElement).disabled).toBe(true);
  expect(stale.getByTestId("oats-unreadable").textContent).toContain("Acts are off.");
});

// Behind a lifecycle result that says the agent changed, the home's cards read the same rule as its thread's line (ruled
// with L13's form, from the fourth review round): "Reading…" in the state's place and the card's acts off, until the
// window holds a roster read after the act ended.
test("behind a result the home's card of an agent that runs outside OATS says \"Reading…\" in its state's place, with Stop… and Start… off", async () => {
  const { noteActed } = await import("../../app/roster/reading");
  const report = { code: "running-outside-oats" as const, backend: "bb", message: "a harness runs in weekly-digest-helper on bb, and OATS recorded this instance stopped" };
  const agents = fixtureAgents().map((agent): Agent => (agent.instance === "weekly-digest-helper" ? { ...agent, sessionEnd: "stopped", outsideOats: report } : agent));
  const slot = await homePage({ rpc: handlers({}, agents) });
  const card = await cardOf(slot, "weekly-digest-helper");
  const acts = () => Array.from(within(card).getByTestId("oats-status-line").querySelectorAll("button")).map((button) => [button.textContent, (button as HTMLButtonElement).disabled]);
  expect([within(card).queryByTestId("oats-reading"), acts()]).toEqual([null, [["Stop…", false], ["Start…", false]]]);
  expect(within(card).getByTestId("oats-needs-outside").textContent).toBe("Stop, then Start.");
  act(() => noteActed(["weekly-digest-helper"], fixtureSnapshot(agents).at));
  expect([within(card).getByTestId("oats-reading").textContent, acts()]).toEqual(["Reading…", [["Stop…", true], ["Start…", true]]]);
  expect(within(card).queryByTestId("oats-needs-outside")).toBeNull(); // what it needs is said of a state that is being read again: not behind "Reading…"
  expect(within(card).getByTestId("oats-status-line").textContent).not.toMatch(/Running outside OATS/); // never the state of before, stated plainly
});

test("behind a result the home's card of a stopped agent that asks says \"Reading…\" where it said \"Not running.\", with its Start… off", async () => {
  const { noteActed } = await import("../../app/roster/reading");
  const agents = fixtureAgents().map((agent) => (agent.instance === "flaky-ci-developer" ? { ...agent, running: false as const, runtimeState: "stopped" } : agent));
  const slot = await homePage({ rpc: handlers({}, agents), sdk: BB_ASKS });
  const card = await cardOf(slot, "flaky-ci-developer");
  const start = () => within(card).getByTestId("oats-needs-start") as HTMLButtonElement;
  const said = within(card).getByTestId("oats-needs-stopped").querySelector("p")!.textContent;
  expect([start().disabled, within(card).queryByTestId("oats-needs-reading")]).toEqual([false, null]);
  act(() => noteActed(["flaky-ci-developer"], fixtureSnapshot(agents).at));
  expect([start().disabled, within(card).getByTestId("oats-needs-reading").textContent]).toEqual([true, "Reading…"]);
  expect(within(card).getByTestId("oats-needs-stopped").textContent).not.toContain(said!);
});

// THE FIT OF A FACTS LINE (app/home/Home.tsx, the block of that name; ruled 25 Nov 2026): one design and one measure
// for a card and a row. The measure reads the element's own boxes; jsdom has no layout, so the pure function is tested
// with the widths the third review round MEASURED in a browser (its report, reviews/polish-r3-report.md of the
// text-cut developer), and the drawing with boxes that are given.
test("THE FIT, pure: a card's facts stand beside the name only when the WHOLE line fits (the soul unshortened, the mark with its age after it); else under the name; and where even what they never give up does not fit there with the mark, the reason wins and the mark takes the next line", async () => {
  const { factsFit } = await import("../../app/home/Home");
  const card = (of: { line: number; name: number; whole: number; held: number; wait: number }) => factsFit({ kind: "card", gap: 8, least: 21, holds: false, ...of });
  // 1280: everything on one line.
  expect(card({ line: 829, name: 150, whole: 199, held: 119, wait: 44 })).toBe("beside");
  // Round 3's first case at 390: "Flaky test" (70.1), oats-developer · deleted in bb (whole 101 + 11.9 + 86.2 = 199.1; held 21 + 11.9 + 86.2 = 119.1), "59 min" (70): line 259.7.
  // Beside it needs 70.1 + 8 + 199.1 + 8 + 70 = 355.2: UNDER (it was drawn beside, the reason cut by 11.6 px).
  expect(card({ line: 259.7, name: 70.1, whole: 199.1, held: 119.1, wait: 70 })).toBe("under");
  // A soul of 24 letters on its thread, name of 6 (51.6), "59 min": whole 171: beside needs 308.6 of 259.7: under, where it is whole (171 + 8 + 70 = 249).
  expect(card({ line: 259.7, name: 51.6, whole: 171, held: 21, wait: 70 })).toBe("under");
  // A short card that fits whole: beside (name 51.6, soul 101, "5 d" 44: 212.6).
  expect(card({ line: 259.7, name: 51.6, whole: 101, held: 21, wait: 44 })).toBe("beside");
  // A tab of 300: "thread not shown in bb" with "59 min": held 148.1 + 8 + 70 = 226.1 of 182.8: the reason wins: SPLIT.
  expect(card({ line: 182.8, name: 70, whole: 228, held: 148.1, wait: 70 })).toBe("split");
  // … and with "5 d" there too (203.8 of 182.8); at 340 with "59 min" (226.1 of 222.8).
  expect(card({ line: 182.8, name: 70, whole: 228, held: 151.8, wait: 44 })).toBe("split");
  expect(card({ line: 222.8, name: 70, whole: 228, held: 148.1, wait: 70 })).toBe("split");
  // No mark on this line (a wait that says words has its own): only the facts count.
  expect(card({ line: 259.7, name: 70.1, whole: 181.6, held: 119.1, wait: 0 })).toBe("beside");
  // No grace: what fits by its own measure is beside (62.24 + 8 + 120 = 190.24 of 190.27); a fraction over goes under
  // (the fourth round's card in a tab of 340: 223.47 of 222.83: beside, it lost the difference from its soul).
  expect(card({ line: 190.27, name: 62.24, whole: 120, held: 120, wait: 0 })).toBe("beside");
  expect(card({ line: 190.27, name: 62.28, whole: 120, held: 120, wait: 0 })).toBe("under");
  expect(card({ line: 222.83, name: 45.53, whole: 124.6, held: 60, wait: 37.34 })).toBe("under");
});

test("THE FIT, pure: a row's soul gives way first; a row goes under the name only where it holds a reason that warns or the glyph and the held part does not fit; a row that holds nothing never takes a second line, and with no room at all its facts are not drawn", async () => {
  const { factsFit } = await import("../../app/home/Home");
  const row = (of: { line: number; name: number; whole: number; held: number; holds: boolean }) => factsFit({ kind: "row", gap: 8, least: 18, wait: 0, ...of });
  // A plain row: one line while the soul's least fits; the soul is cut inside it, the row never wraps.
  expect(row({ line: 356, name: 150, whole: 120, held: 18, holds: false })).toBe("beside");
  expect(row({ line: 356, name: 320, whole: 120, held: 18, holds: false })).toBe("beside"); // 320 + 8 + 18 = 346
  expect(row({ line: 356, name: 335, whole: 120, held: 18, holds: false })).toBe("none"); // no room at all: not drawn, no gap: the name keeps its line
  // A row that holds a warning reason (or the glyph): beside while the held part fits, else under, whole.
  expect(row({ line: 356, name: 150, whole: 200, held: 120, holds: true })).toBe("beside");
  expect(row({ line: 356, name: 228, whole: 200, held: 120, holds: true })).toBe("beside"); // exactly
  expect(row({ line: 356, name: 229, whole: 200, held: 120, holds: true })).toBe("under");
  expect(row({ line: 900, name: 229, whole: 200, held: 120, holds: true })).toBe("beside"); // the same row in a wide window
});

/** A new roster's token for each draw a test asks for (the row and the card measure after every draw). */
let drawn = 0;
/** Boxes for THE FIT's drawing, in a DOM with none: the line's width, the name's, and each part of the facts'. */
function boxes(line: HTMLElement, of: { line: number; name: number; part: (part: HTMLElement) => number }) {
  const name = line.firstElementChild as HTMLElement;
  const width = (element: HTMLElement) => (element === line ? of.line : element === name ? of.name : of.part(element));
  const box = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const w = width(this);
    return { x: 0, y: 0, left: 0, top: 0, right: w, bottom: 16, width: w, height: 16, toJSON: () => ({}) };
  });
  const scroll = vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
    return width(this);
  });
  return () => {
    box.mockRestore();
    scroll.mockRestore();
  };
}
const partWidth = (widths: Record<string, number>) => (part: HTMLElement) => (part.hasAttribute("data-wait") ? (widths.wait ?? 0) : (widths[part.getAttribute("data-phrase") ?? `sep`] ?? 0));

test("THE FIT, drawn, a ROW: a row on tmux whose name leaves no room for the glyph has its facts under the name, whole; a plain row beside it stays one line, and one with no room at all draws no facts beside its name", async () => {
  const agents = fixtureAgents().map((agent): Agent => (agent.instance === "kernel-fix-developer" ? { ...agent, running: true, runtimeState: "running" } : agent));
  const slot = await homePage({ rpc: handlers({}, agents) });
  const rows = await slot.findAllByTestId("oats-working-row");
  for (const row of rows) expect(row.querySelector("[data-fit]")!.getAttribute("data-fit")).toBe("beside"); // no layout: one line
  const tmux = rows.find((row) => row.querySelector('[data-phrase="where"]') !== null)!;
  const plain = rows.find((row) => row !== tmux && row.querySelector('[data-phrase="where"]') === null && row.querySelector('[data-tone="warning"]') === null)!;
  const again = () => act(async () => slot.behavior.emitRealtime("oats/changed", { at: `2026-11-23T18:17:${String((drawn += 1) + 20).padStart(2, "0")}.000Z` }));
  // The name takes 340 of 356: the glyph (16) with its separator (12) and the soul's least do not fit beside it.
  let undo = boxes(tmux.querySelector<HTMLElement>("[data-fit]")!, { line: 356, name: 340, part: partWidth({ soul: 100, where: 16, sep: 12 }) });
  try {
    await again();
    const line = tmux.querySelector<HTMLElement>("[data-fit]")!;
    await waitFor(() => expect(line.getAttribute("data-fit")).toBe("under"));
    expect(line.className.split(/\s+/)).toContain("flex-wrap");
    expect(within(tmux).getByTestId("oats-home-agent-where").className.split(/\s+/)).toContain("basis-full");
  } finally {
    undo();
  }
  // A plain row in the same boxes: no room for its soul's least: not drawn beside the name (kept for a screen reader), and the row does not wrap.
  undo = boxes(plain.querySelector<HTMLElement>("[data-fit]")!, { line: 356, name: 345, part: partWidth({ soul: 100 }) });
  try {
    await again();
    const line = plain.querySelector<HTMLElement>("[data-fit]")!;
    await waitFor(() => expect(line.getAttribute("data-fit")).toBe("none"));
    expect(line.className.split(/\s+/)).not.toContain("flex-wrap");
    expect(within(plain).getByTestId("oats-home-agent-where").className.split(/\s+/)).toContain("sr-only");
  } finally {
    undo();
  }
});

test("THE FIT, drawn, a CARD: where the whole line does not fit beside the name the unit stands under it; where even the held part does not fit there with the mark, the facts keep the line and the mark with its age takes the next", async () => {
  // (A card with a reason: the agent's thread was deleted in bb.)
  const sdk = { threads: { list: async () => [], interactions: { list: async () => [] } } } as never as RenderSlotOptions<Contract>["sdk"];
  const slot = await homePage({ sidebarThreads: { status: "ready", threads: fixtureThreads().filter((thread) => thread.id !== "thr_release") }, sdk });
  const card = await cardOf(slot, "release-070-maintainer");
  await waitFor(() => expect(within(card).getByTestId("oats-needs-where").querySelector('[data-phrase="reason"]')).not.toBeNull());
  const line = card.querySelector<HTMLElement>("[data-fit]")!;
  const unit = within(card).getByTestId("oats-needs-facts");
  const facts = within(card).getByTestId("oats-needs-where");
  expect(line.getAttribute("data-fit")).toBe("beside");
  const again = () => act(async () => slot.behavior.emitRealtime("oats/changed", { at: `2026-11-23T18:18:${String((drawn += 1) + 10).padStart(2, "0")}.000Z` }));
  const parts = partWidth({ soul: 101, reason: 86, sep: 12, wait: 44 });
  // 390: name 150 + 8 + (101 + 12 + 86 = 199) + 8 + 44 = 409 of 260: under; there 21 + 12 + 86 + 8 + 44 = 171 fits: the mark stays after the facts.
  let undo = boxes(line, { line: 260, name: 150, part: parts });
  try {
    await again();
    await waitFor(() => expect(line.getAttribute("data-fit")).toBe("under"));
    expect(line.className.split(/\s+/)).toContain("flex-wrap");
    expect(unit.className.split(/\s+/)).toEqual(expect.arrayContaining(["basis-full"]));
    expect(unit.className.split(/\s+/)).not.toContain("flex-wrap");
    expect(facts.className.split(/\s+/)).toEqual(expect.arrayContaining(["flex-1", "basis-0"]));
  } finally {
    undo();
  }
  // A line of 150: even 171 does not fit: the reason wins: the facts take the line, the mark with its age the next.
  undo = boxes(line, { line: 150, name: 150, part: parts });
  try {
    await again();
    await waitFor(() => expect(line.getAttribute("data-fit")).toBe("split"));
    expect(unit.className.split(/\s+/)).toEqual(expect.arrayContaining(["basis-full", "flex-wrap"]));
    expect(facts.className.split(/\s+/)).toContain("basis-full");
    expect(facts.querySelector('[data-phrase="reason"]')!.className.split(/\s+/)).toContain("shrink-0"); // never cut
  } finally {
    undo();
  }
  // Wide again: one line.
  undo = boxes(line, { line: 829, name: 150, part: parts });
  try {
    await again();
    await waitFor(() => expect(line.getAttribute("data-fit")).toBe("beside"));
    expect(line.className.split(/\s+/)).not.toContain("flex-wrap");
  } finally {
    undo();
  }
});

/** The one count line of the home, on Home › Agents ("2 running · 4 need you · …"), for a roster. */
async function agentsLine(agents: Agent[]): Promise<string> {
  const app = await loadApp();
  const panel = app.navPanels.find((candidate) => candidate.id === "home")!;
  const list = renderSlot<{ subPath: string }, Contract>(panel, { subPath: "agents" }, { rpc: handlers({}, agents), sidebarThreads: sidebarThreads(), sdk: NO_INTERACTIONS });
  const line = (await list.findByTestId("oats-home-summary")).textContent!;
  list.unmount();
  return line;
}

// ---- what a card offers, by what its agent asks (the lead's ruling on the home's UX read)

const offerOf = (card: HTMLElement) => card.dataset.offer;
/** Whether an element is inside a fold that a person has to open first. */
const folded = (element: HTMLElement) => element.closest("details") !== null && !(element.closest("details") as HTMLDetailsElement).open;

test("an agent that asks in its own words is answered by the reply, on its card; one that waits for an approval is not", async () => {
  const slot = await homePage({ sidebarThreads: calm() }); // bb lists no pending request for any thread
  const asks = await cardOf(slot, "ranker-v3-probe");
  expect(offerOf(asks)).toBe("reply");
  expect(within(asks).getByTestId("oats-reply-text").closest("details")).toBeNull();
  expect(within(asks).getByTestId("oats-needs-open").textContent).toBe("Open");
  // The kernel says it waits for a tool approval, and bb lists no request to answer: the answer is in its thread.
  const permission = await cardOf(slot, "flaky-ci-developer");
  expect(offerOf(permission)).toBe("in-thread");
  // Its button says "Answer" in the place of "Open" (the same press: it opens the thread; its name says whose); no sentence says so.
  expect(within(permission).queryByTestId("oats-needs-in-thread")).toBeNull();
  expect(permission.textContent).not.toContain("Answer it in its thread.");
  expect([within(permission).getByTestId("oats-needs-open").textContent, within(permission).getByTestId("oats-needs-open").getAttribute("aria-label")]).toEqual(["Answer", "Answer in its thread: Flaky ci developer"]);
  // a message is not offered beside it as an equal: it is behind a fold, with what a message does not do
  const fold = within(permission).getByTestId("oats-needs-message");
  expect(fold.querySelector("summary")!.textContent).toBe("▸Message instead");
  expect((fold as HTMLDetailsElement).open).toBe(false);
  expect(folded(within(permission).getByTestId("oats-reply-text"))).toBe(true);
  expect(fold.textContent).toContain("A message does not answer its request: it grants nothing, and the request stays open.");
});

test("while bb lists choices the choices are the answer: the reply is behind the fold, and a pressed choice is said on the card", async () => {
  let pending = true;
  const slot = await homePage({
    sdk: {
      threads: {
        interactions: {
          list: async () => (pending ? [{ id: "pint_9", threadId: "thr_ci", status: "pending", payload: { kind: "approval", reason: "scripted", subject: { kind: "command", command: "git push --force" }, availableDecisions: ["allow_once", "deny"] } }] : []) as never,
          resolve: async () => ((pending = false), {}) as never,
        },
      },
    },
  });
  const card = await cardOf(slot, "flaky-ci-developer");
  await waitFor(() => expect(offerOf(card)).toBe("choices"));
  expect(within(card).getAllByTestId("oats-needs-choice").map((choice) => choice.textContent)).toEqual(["Allow", "Deny"]);
  expect(within(card).queryByTestId("oats-needs-in-thread")).toBeNull();
  expect(folded(within(card).getByTestId("oats-reply-text"))).toBe(true);
  expect(within(card).getByTestId("oats-needs-message").textContent).toContain("A message does not answer its request");
  fireEvent.click(within(card).getAllByTestId("oats-needs-choice")[0]!);
  // what the card says after a choice is pressed: the answer, and nothing left to press but Open
  expect((await within(card).findByTestId("oats-needs-answered")).textContent).toBe("Answered: Allow.");
  expect(offerOf(card)).toBe("answered");
  expect(within(card).queryAllByTestId("oats-needs-choice")).toEqual([]);
  expect(within(card).queryByTestId("oats-reply")).toBeNull();
  expect(within(card).queryByTestId("oats-needs-in-thread")).toBeNull();
  expect(Array.from(card.querySelectorAll("button")).map((button) => button.textContent)).toEqual(["Open"]);
});

test("a request bb shows in a form the card cannot draw is answered in the thread, and the card answers it", async () => {
  const slot = await homePage({
    sdk: { threads: { interactions: { list: async () => [{ id: "pint_4", threadId: "thr_ci", status: "pending", payload: { kind: "plugin", title: "A plugin's form", data: {} } }] as never } } },
  });
  const card = await cardOf(slot, "flaky-ci-developer");
  await waitFor(() => expect(slot.inspection.sdkCalls.length).toBeGreaterThan(0));
  expect(offerOf(card)).toBe("in-thread");
  expect(within(card).queryByTestId("oats-needs-in-thread")).toBeNull();
  expect([within(card).getByTestId("oats-needs-open").textContent, within(card).getByTestId("oats-needs-open").getAttribute("aria-label")]).toEqual(["Answer", "Answer in its thread: Flaky ci developer"]); // the card's button leads there
  fireEvent.click(within(card).getByTestId("oats-needs-open"));
  expect(slot.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: "thr_ci" }); // the same press as Open: no send
});

test("those a person can answer here come first: an agent with no bb thread comes after, however new its claim", async () => {
  const slot = await homePage({ rpc: handlers({}, [...fixtureAgents(), { ...TMUX_ASKS, waiting: { ...TMUX_ASKS.waiting!, since: "2026-11-19T12:59:00.000Z" } }]) });
  await cardOf(slot, "night-watch-helper");
  const order = slot.getAllByTestId("oats-needs-card").map((card) => card.dataset.instance);
  expect(order).toHaveLength(4);
  expect(order[3]).toBe("night-watch-helper");
});

test("Check again asks the server to read the installed oats anew: after the install the card goes and New agent is on, with no reload", async () => {
  let installed: { version: string | null; desktopApi: number | null; state: "older" | "tested" } = { version: "0.69.4", desktopApi: 1, state: "older" };
  const slot = await homePage({ rpc: { ...handlers({}, []), homeCli: () => installed } as Handlers, sidebarThreads: calm() });
  await slot.findByTestId("oats-home-cli");
  expect((slot.getByTestId("oats-home-new-agent") as HTMLButtonElement).disabled).toBe(true);
  installed = { version: "0.70.3", desktopApi: 1, state: "tested" };
  const before = slot.inspection.rpcCalls.filter((call) => call.method === "homeCli").length;
  fireEvent.click(slot.getByTestId("oats-home-cli-retry"));
  await waitFor(() => expect(slot.queryByTestId("oats-home-cli")).toBeNull());
  expect((slot.getByTestId("oats-home-new-agent") as HTMLButtonElement).disabled).toBe(false);
  // the read's own retry: the server is asked to read OATS again (it drops the version it keeps), then the version is read
  const calls = slot.inspection.rpcCalls.map((call) => call.method);
  expect(calls).toContain("refresh");
  expect(calls.filter((method) => method === "homeCli").length).toBe(before + 1);
});

/** bb holds a question, with two options, on the thread of flaky-ci-developer. */
const BB_ASKS = {
  threads: {
    interactions: {
      list: async () =>
        [{ id: "pint_s", threadId: "thr_ci", status: "pending", payload: { kind: "user_question", questions: [{ id: "q", prompt: "Which shard do I rerun?", multiSelect: false, allowFreeText: false, options: [{ label: "One", value: "1" }, { label: "Two", value: "2" }] }] } }] as never,
      respond: async () => ({}) as never,
      resolve: async () => ({}) as never,
    },
    send: async () => ({ ok: true }) as never,
  },
};

test.each([
  ["OATS has it stopped", { running: false as const, runtimeState: "stopped" }, "Which shard do I rerun?"],
  // An operator's stop that says so (`sessionEnd: "stopped"`), and the stale stop beside "unknown": the stop wins.
  ["an operator stopped it", { running: false as const, runtimeState: "stopped", sessionEnd: "stopped" }, "Which shard do I rerun?"],
  ["it still says an operator stopped it, beside \"unknown\"", { running: false as const, runtimeState: "unknown", sessionEnd: "stopped" }, "Which shard do I rerun?"],
  ["the kernel's word is stopped, with no word on whether it runs", { running: null, runtimeState: "stopped" }, null],
])("an agent the kernel calls stopped (%s) while bb holds a request on its thread: no answer and no message on its card, which says so and offers Start", async (_what, change, question) => {
  // An answer or a message to that thread would start the agent's harness again behind OATS's back: a stopped agent stays stopped.
  const { asked } = await import("../../app/lifecycle");
  const agents = fixtureAgents().map((agent) => (agent.instance === "flaky-ci-developer" ? { ...agent, ...change } : agent));
  expect(agents.find((agent) => agent.instance === "flaky-ci-developer")!.waiting?.message).toBe("needs your permission to use Bash");
  const slot = await homePage({ rpc: handlers({}, agents), sdk: BB_ASKS });
  const card = await cardOf(slot, "flaky-ci-developer");
  await waitFor(() => expect(slot.inspection.sdkCalls.some((call) => call.method === "threads.interactions.list")).toBe(true));
  await waitFor(() => expect(card.dataset.offer).toBe("stopped"));
  // What it asks is still said: bb's request where OATS has it stopped (the claim such an agent still carries is no question of now).
  if (question !== null) await waitFor(() => expect(within(card).getByTestId("oats-needs-question").textContent).toBe(question));
  if (question === "Which shard do I rerun?") {
    expect(card.textContent).not.toContain("needs your permission to use Bash");
    expect(within(card).queryByTestId("oats-needs-detail")).toBeNull();
  }
  // no way to answer it and no way to write to it: not a choice, not a reply, not the fold that holds one
  expect(within(card).queryAllByTestId("oats-needs-choice")).toEqual([]);
  expect(within(card).queryByTestId("oats-reply")).toBeNull();
  expect(within(card).queryByTestId("oats-reply-send")).toBeNull();
  expect(within(card).queryByTestId("oats-reply-text")).toBeNull();
  expect(within(card).queryByTestId("oats-needs-message")).toBeNull();
  // SAFETY, carried by design: the card draws no answer and no reply at all (above); it says that the
  // agent does not run and what to do, and the one act under the sentence is Start, through OATS.
  expect(within(card).getByTestId("oats-needs-stopped").textContent).toBe("Not running.Start…");
  // the two things to press: its thread, and Start, which opens the lifecycle's dialog (nothing is started on the press)
  expect(Array.from(card.querySelectorAll("button")).map((button) => button.textContent)).toEqual(["Open", "Start…"]);
  fireEvent.click(within(card).getByTestId("oats-needs-start"));
  expect(asked()).toEqual({ verb: "start", instance: "flaky-ci-developer" });
  expect(slot.inspection.sdkCalls.filter((call) => call.method !== "threads.interactions.list")).toEqual([]);
});

test("an agent the kernel cannot reach while bb holds a request on its thread: no answer and no message on its card, which says that nothing is sent from here; no Start", async () => {
  // The row the kernel prints for it: `running: null` beside "unreachable" (awebai/oats lib/instance-listing.mjs at v0.70.5). Nobody can tell where an answer would go.
  const agents = fixtureAgents().map((agent) => (agent.instance === "flaky-ci-developer" ? { ...agent, running: null, runtimeState: "unreachable" } : agent));
  const slot = await homePage({ rpc: handlers({}, agents), sdk: BB_ASKS });
  const card = await cardOf(slot, "flaky-ci-developer");
  await waitFor(() => expect(slot.inspection.sdkCalls.some((call) => call.method === "threads.interactions.list")).toBe(true));
  await waitFor(() => expect(card.dataset.offer).toBe("unreachable"));
  expect(within(card).getByTestId("oats-needs-unreachable").textContent).toBe("Unreachable. Nothing is sent from here."); // (the card draws the mark alone, under "Needs you": the word is said here, once)
  expect(card.textContent!.split("Unreachable").length - 1).toBe(1);
  expect(within(card).queryAllByTestId("oats-needs-choice")).toEqual([]);
  for (const id of ["oats-reply", "oats-reply-send", "oats-needs-message", "oats-needs-stopped", "oats-needs-start"]) expect(within(card).queryByTestId(id)).toBeNull();
  expect(Array.from(card.querySelectorAll("button")).map((button) => button.textContent)).toEqual(["Open"]);
  expect(slot.inspection.sdkCalls.filter((call) => call.method !== "threads.interactions.list")).toEqual([]);
});

test("an agent whose session was lost, on a thread whose last turn bb calls failed, is answered as on any listed thread", async () => {
  const agents = fixtureAgents().map((agent) => (agent.instance === "flaky-ci-developer" ? { ...agent, running: false as const, runtimeState: "stopped", sessionEnd: "lost" } : agent));
  const threads = sidebarThreads();
  // bb says of that thread's events that a turn started (its LATER turn failed): until it has, the thread may be one that never started, and the card would not answer.
  const events = { list: async ({ types }: { types: readonly string[] }) => (types.includes("turn/started") ? [{ type: "turn/started", seq: 5, data: {} }] : []) };
  const slot = await homePage({ rpc: handlers({}, agents), sdk: { threads: { ...BB_ASKS.threads, events } } as never, sidebarThreads: { ...threads, threads: threads.threads.map((thread) => (thread.id === "thr_ci" ? { ...thread, status: "error" as const } : thread)) } });
  const card = await cardOf(slot, "flaky-ci-developer");
  await waitFor(() => expect(within(card).getAllByTestId("oats-needs-choice").map((choice) => choice.textContent)).toEqual(["One", "Two"]));
  expect(within(card).queryByTestId("oats-needs-stopped")).toBeNull();
});

test("an agent whose session was LOST while bb holds a request on its thread is answered from its card: bb's choices, no Start", async () => {
  // Nobody stopped it, and a message in its thread is how it comes back (the Start dialog says the same first).
  const agents = fixtureAgents().map((agent) => (agent.instance === "flaky-ci-developer" ? { ...agent, running: false as const, runtimeState: "stopped", sessionEnd: "lost" } : agent));
  const slot = await homePage({ rpc: handlers({}, agents), sdk: BB_ASKS });
  const card = await cardOf(slot, "flaky-ci-developer");
  await waitFor(() => expect(within(card).getAllByTestId("oats-needs-choice").map((choice) => choice.textContent)).toEqual(["One", "Two"]));
  expect(card.dataset.offer).toBe("choices");
  expect(within(card).queryByTestId("oats-needs-stopped")).toBeNull();
  expect(within(card).queryByTestId("oats-needs-start")).toBeNull();
});

test("the same agent, running: its card offers bb's choices; and Start on a stopped one's card is held while the roster is the last one read, under the page's notice", async () => {
  const running = await homePage({ sdk: BB_ASKS });
  const card = await cardOf(running, "flaky-ci-developer");
  await waitFor(() => expect(within(card).getAllByTestId("oats-needs-choice").map((choice) => choice.textContent)).toEqual(["One", "Two"]));
  expect(within(card).queryByTestId("oats-needs-stopped")).toBeNull();
  running.unmount();
  const agents = fixtureAgents().map((agent) => (agent.instance === "flaky-ci-developer" ? { ...agent, running: false as const, runtimeState: "stopped" } : agent));
  const last = { at: new Date(Date.now() - 2 * 60_000).toISOString(), deployment: { root: "/abs/deployment", workspace: "oats", machine: "falcon" }, agents };
  const stale = await homePage({ rpc: handlers({ snapshot: () => ({ ok: false, at: new Date().toISOString(), code: "OATS_TIMEOUT", message: "`oats` did not answer within 20 s and was stopped", last }) }), sdk: BB_ASKS });
  const held = await cardOf(stale, "flaky-ci-developer");
  expect((within(held).getByTestId("oats-needs-start") as HTMLButtonElement).disabled).toBe(true);
  // Off, and not alone: no reason on the card, and the roster's notice on the same screen says the acts are off, with Retry.
  expect(within(held).queryByTestId("oats-disabled-reason")).toBeNull();
  expect(within(stale.getByRole("alert")).getByTestId("oats-held").textContent).toBe("Acts are off.");
  expect(within(stale.getByRole("alert")).getByRole("button", { name: "Retry" })).toBeTruthy();
  fireEvent.click(within(held).getByTestId("oats-needs-start"));
  const { asked } = await import("../../app/lifecycle");
  expect(asked()).toBeNull();
});

test("an agent that asks again by a claim of its own, after a choice was pressed: the card is about the new question, not the old answer", async () => {
  let agents = fixtureAgents();
  let pending = true;
  const slot = await homePage({
    rpc: handlers({ snapshot: () => fixtureSnapshot(agents) }),
    sdk: {
      threads: {
        interactions: {
          list: async () => (pending ? [{ id: "pint_a", threadId: "thr_ci", status: "pending", payload: { kind: "approval", reason: "scripted", subject: { kind: "command", command: "git push" }, availableDecisions: ["allow_once", "deny"] } }] : []) as never,
          resolve: async () => ((pending = false), {}) as never,
        },
      },
    },
  });
  const card = await cardOf(slot, "flaky-ci-developer");
  await waitFor(() => expect(within(card).getAllByTestId("oats-needs-choice")).toHaveLength(2));
  fireEvent.click(within(card).getAllByTestId("oats-needs-choice")[0]!);
  expect((await within(card).findByTestId("oats-needs-answered")).textContent).toBe("Answered: Allow.");
  // It goes on, and asks for the person's attention: bb lists nothing more, the kernel's claim is another one.
  agents = agents.map((agent) => (agent.instance === "flaky-ci-developer" ? { ...agent, waiting: { reason: "attention", message: "Which base branch do I use?", since: "2026-11-19T12:50:00.000Z" } } : agent));
  await act(async () => {
    await slot.behavior.emitRealtime("oats/changed", { at: "2026-11-19T12:51:00.000Z" });
  });
  const now = () => slot.getAllByTestId("oats-needs-card").find((each) => each.dataset.instance === "flaky-ci-developer")!;
  await waitFor(() => expect(within(now()).getByTestId("oats-needs-question").textContent).toBe("Which base branch do I use?"));
  expect(within(now()).queryByTestId("oats-needs-answered")).toBeNull();
  // (The test harness cannot take bb's pending mark off the thread, so the card says the answer is in the thread; with bb's mark gone it offers the reply.)
  expect(now().dataset.offer).toBe("in-thread");
  expect(within(now()).getByTestId("oats-reply-text")).toBeTruthy();
});

test("a check whose answer is the same as before ends: Check again can be pressed again", async () => {
  const slot = await homePage({ rpc: { ...handlers(), homeCli: () => ({ version: "0.69.4", desktopApi: 1, state: "older" as const }) } as Handlers });
  await slot.findByTestId("oats-home-cli");
  const asked = () => slot.inspection.rpcCalls.filter((call) => call.method === "homeCli").length;
  const before = asked();
  fireEvent.click(slot.getByTestId("oats-home-cli-retry"));
  await waitFor(() => expect(asked()).toBe(before + 1));
  await waitFor(() => expect(slot.getByTestId("oats-home-cli-retry").textContent).toBe("Check again"));
  expect((slot.getByTestId("oats-home-cli-retry") as HTMLButtonElement).disabled).toBe(false);
  // and a second press asks again
  fireEvent.click(slot.getByTestId("oats-home-cli-retry"));
  await waitFor(() => expect(asked()).toBe(before + 2));
  await waitFor(() => expect(slot.getByTestId("oats-home-cli-retry").textContent).toBe("Check again"));
});

test("a check that fails ends too, and the card keeps what was read before", async () => {
  let failing = false;
  const slot = await homePage({
    rpc: {
      ...handlers(),
      homeCli: () => {
        if (failing) throw new Error("OATS_TIMEOUT: oats did not answer");
        return { version: "0.69.4", desktopApi: 1, state: "older" as const };
      },
    } as Handlers,
  });
  await slot.findByTestId("oats-home-cli");
  failing = true;
  fireEvent.click(slot.getByTestId("oats-home-cli-retry"));
  await waitFor(() => expect(slot.inspection.rpcCalls.filter((call) => call.method === "homeCli").length).toBe(2));
  await waitFor(() => expect(slot.getByTestId("oats-home-cli-retry").textContent).toBe("Check again"));
  expect(slot.getByTestId("oats-home-cli").textContent).toContain("Detected0.69.4");
  expect(slot.getByTestId("oats-home-cli-check-failed").textContent).toBe("Check failed: OATS_TIMEOUT: oats did not answer");
});

test("New agent is on every home, first on the page: with agents too, on the page and in the tab; off under the roster's notice while the roster is the last one read", async () => {
  const slot = await homePage();
  await slot.findByTestId("oats-home-needs");
  const head = slot.getByTestId("oats-home-head");
  expect(head.textContent).toBe("New agent"); // the page has no heading of its own: bb's bar names it
  // above everything else of the home
  expect(head.compareDocumentPosition(slot.getByTestId("oats-home-needs")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(slot.getByTestId("oats-home-new-agent"));
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "new-agent" }]); // the form's own page (app/spawn)
  slot.unmount();
  // Home › Agents keeps it
  const app = await loadApp();
  const panel = app.navPanels.find((candidate) => candidate.id === "home")!;
  const list = renderSlot<{ subPath: string }, Contract>(panel, { subPath: "agents" }, { rpc: handlers(), sidebarThreads: sidebarThreads(), sdk: NO_INTERACTIONS });
  await list.findByTestId("oats-home-agents");
  expect(list.getByTestId("oats-home-new-agent")).toBeTruthy();
  list.unmount();
  // in the tab too: the row holds the button alone
  const tab = await plainTab();
  await tab.findByTestId("oats-home-needs");
  expect(tab.getByTestId("oats-home-head").textContent).toBe("New agent");
  expect(tab.queryByTestId("oats-home-title")).toBeNull();
  tab.unmount();
  // the roster as last read: off, with no reason beside it; the roster's notice under it, on the same screen, says why
  const last = { at: new Date(Date.now() - 2 * 60_000).toISOString(), deployment: { root: "/abs/deployment", workspace: "oats", machine: "falcon" }, agents: fixtureAgents() };
  const stale = await homePage({ rpc: handlers({ snapshot: () => ({ ok: false, at: new Date().toISOString(), code: "OATS_TIMEOUT", message: "`oats` did not answer within 20 s and was stopped", last }) }) });
  await stale.findByTestId("oats-home-needs");
  expect((stale.getByTestId("oats-home-new-agent") as HTMLButtonElement).disabled).toBe(true);
  expect(stale.getByTestId("oats-home-head").textContent).toBe("New agent");
  expect(stale.queryByTestId("oats-disabled-reason")).toBeNull();
  expect((stale.getByTestId("oats-home-new-agent") as HTMLButtonElement).title).toBe("");
  expect(within(stale.getByRole("alert")).getByTestId("oats-held").textContent).toBe("Acts are off.");
  expect(within(stale.getByRole("alert")).getByRole("button", { name: "Retry" })).toBeTruthy();
  fireEvent.click(stale.getByTestId("oats-home-new-agent"));
  expect(stale.inspection.navigateCalls).toEqual([]);
  stale.unmount();
  // under the release's default pages it is still there, and opens the form: the spawn feature names its page whatever is shown
  const pilot = await homePage({ settings: { pages: "home" } });
  await pilot.findByTestId("oats-home-needs");
  expect(pilot.getByTestId("oats-home-head").textContent).toBe("New agent");
  fireEvent.click(pilot.getByTestId("oats-home-new-agent"));
  expect(pilot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "new-agent" }]);
  pilot.unmount();
  // where New agent has nowhere to open (the default pages, and no form's page named), it is not drawn
  const { setNewAgent } = await import("../../app/workspace/pages");
  const { openNewAgent } = await import("../../app/spawn");
  const loaded = await loadApp(); // the app's register names the form's page: taken away after it, for this case alone
  setNewAgent(null);
  try {
    const nowhere = renderSlot<{ subPath: string }, Contract>(loaded.navPanels.find((candidate) => candidate.id === "home")!, { subPath: "" }, { rpc: handlers(), sidebarThreads: sidebarThreads(), sdk: NO_INTERACTIONS, settings: { pages: "home" } });
    await nowhere.findByTestId("oats-home-needs");
    expect(nowhere.queryByTestId("oats-home-new-agent")).toBeNull();
    expect(nowhere.getByTestId("oats-home-head").textContent).toBe("");
  } finally {
    setNewAgent(openNewAgent); // as the spawn feature's register left it
  }
});

test("the home's one more try of the version waits for the roster: none while the roster is not read, one once it is", async () => {
  let rosterFails = true;
  const slot = await homePage({
    rpc: {
      ...handlers({ snapshot: () => (rosterFails ? { ok: false as const, at: "t", code: "OATS_TIMEOUT", message: "oats did not answer" } : fixtureSnapshot()) }),
      homeCli: () => {
        throw new Error("OATS_TIMEOUT: oats did not answer");
      },
    } as Handlers,
  });
  const asked = () => slot.inspection.rpcCalls.filter((call) => call.method === "homeCli").length;
  // OATS cannot be read at all: the roster's notice says it; the version was asked once, and is not asked again
  await slot.findByRole("alert");
  await waitFor(() => expect(asked()).toBe(1));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(asked()).toBe(1);
  expect(slot.queryByTestId("oats-home-cli-unchecked")).toBeNull();
  // the roster reads: now the one more try is made; failing too, nothing is said of it (nothing is off)
  rosterFails = false;
  await act(async () => {
    await slot.behavior.emitRealtime("oats/changed", { at: "2026-11-19T12:55:00.000Z" });
  });
  await slot.findByTestId("oats-home-needs");
  await waitFor(() => expect(asked()).toBe(2));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(asked()).toBe(2);
  expect(slot.queryByTestId("oats-home-cli-unchecked")).toBeNull();
  expect(slot.getByTestId("oats-home-page").textContent).not.toMatch(/could not be checked/);
  expect((slot.getByTestId("oats-home-new-agent") as HTMLButtonElement).disabled).toBe(false);
});

// An agent whose thread bb no longer has and that still needs the person: nothing can be sent to
// it from bb. The card's second line says what became of its thread, as the reason alone (bb's own
// answer: "deleted in bb"); no sentence repeats it, and the card draws no reply. Open leads to its page.
test("an agent whose bb thread was deleted that needs the person: the reason and its soul on its name's line, the reason held whatever its tone, no sentence under it, no reply, and Open to its page", async () => {
  vi.useFakeTimers({ now: FOUR_DAYS_ON, toFake: ["Date"] }); // (the card's wait is pinned below: never the real clock)
  const sdk = { threads: { list: async () => [], interactions: { list: async () => [] } } } as never as RenderSlotOptions<Contract>["sdk"];
  const slot = await homePage({ sidebarThreads: { status: "ready", threads: fixtureThreads().filter((thread) => thread.id !== "thr_release") }, sdk });
  const card = await cardOf(slot, "release-070-maintainer");
  await waitFor(() => expect(within(card).getByTestId("oats-needs-where").textContent).toBe("oats-maintainer · deleted in bb"));
  expect(card.textContent).toBe("Release 070 maintaineroats-maintainer · deleted in bb!4 dOpenGreen light at 9f2e1c? Second reader done.");
  // The reason is the card's only word on why there is no reply: it never shrinks and never leaves (the soul gives way), though it does not warn here.
  const why = card.querySelector('[data-testid="oats-needs-where"] [data-phrase="reason"]')!;
  expect([why.textContent, why.getAttribute("data-tone"), why.className.split(/\s+/).includes("shrink-0"), card.querySelector('[data-testid="oats-needs-where"]')!.getAttribute("data-reason")]).toEqual(["deleted in bb", null, true, "shown"]);
  expect(card.textContent).not.toContain("so nothing can be sent to it from here");
  expect(within(card).queryByTestId("oats-needs-elsewhere")).toBeNull();
  expect(within(card).queryByTestId("oats-reply")).toBeNull();
  expect(within(card).getByTestId("oats-needs-open").getAttribute("aria-label")).toBe("Open its page: Release 070 maintainer");
});

test("an agent nobody stopped whose way on is a message (no harness is loaded) is answered from its card, on a thread bb lists; one whose harness ended by itself is not", async () => {
  // The one reading of "a message carries it on" (model/rest.ts), which the Start dialog's first line and the thread's
  // line read too: said only where a fact shows it. A harness that ended by itself (a shell, "exited") has none: its
  // card does not answer into the thread, and offers Start.
  for (const [what, change] of [
    ["its session ended in a shell", { running: false as const, runtimeState: "shell" }],
    ["its harness ended by itself", { running: false as const, runtimeState: "stopped", sessionEnd: "exited" }],
  ] as const) {
    const agents = fixtureAgents().map((agent) => (agent.instance === "flaky-ci-developer" ? { ...agent, ...change, waiting: { reason: "attention", message: "Which branch do I use?", since: "2026-11-19T12:00:00.000Z" } } : agent));
    const slot = await homePage({ rpc: handlers({}, agents), sidebarThreads: calm() });
    const card = await cardOf(slot, "flaky-ci-developer");
    expect(card.dataset.offer, what).toBe("stopped");
    expect(within(card).queryByTestId("oats-reply-send"), what).toBeNull();
    expect(within(card).getByTestId("oats-needs-stopped"), what).toBeTruthy();
    slot.unmount();
    resetApp();
  }
  for (const [what, change] of [
    // (A lost session's claim is not shown, the claim's gate: its card is the one of bb's own question, above.)
    ["no harness is loaded", { running: false as const, runtimeState: "unknown" }],
  ] as const) {
    const agents = fixtureAgents().map((agent) => (agent.instance === "flaky-ci-developer" ? { ...agent, ...change, waiting: { reason: "attention", message: "Which branch do I use?", since: "2026-11-19T12:00:00.000Z" } } : agent));
    const slot = await homePage({ rpc: handlers({}, agents), sidebarThreads: calm() });
    const card = await cardOf(slot, "flaky-ci-developer");
    expect(card.dataset.offer, what).toBe("reply");
    expect(within(card).getByTestId("oats-needs-question").textContent).toBe("Which branch do I use?");
    expect(within(card).getByTestId("oats-reply-send")).toBeTruthy();
    expect(within(card).queryByTestId("oats-needs-stopped")).toBeNull();
    slot.unmount();
    resetApp();
  }
});

test("a press on an agent OATS stopped since its card was drawn sends nothing: the roster the server holds is asked at the press", async () => {
  // The card is drawn from a roster in which the agent runs. OATS then stops it, and nothing has told
  // this window yet (no change event, no redraw): the choice and the reply are still on the card.
  let agents = fixtureAgents();
  const slot = await homePage({ rpc: handlers({ snapshot: () => fixtureSnapshot(agents) }), sdk: BB_ASKS });
  const answers = await cardOf(slot, "flaky-ci-developer");
  await waitFor(() => expect(within(answers).getAllByTestId("oats-needs-choice")).toHaveLength(2));
  const writes = await cardOf(slot, "ranker-v3-probe");
  fireEvent.change(within(writes).getByTestId("oats-reply-text"), { target: { value: "keep depth 6" } });
  agents = agents.map((agent) => (["flaky-ci-developer", "ranker-v3-probe"].includes(agent.instance) ? { ...agent, running: false as const, runtimeState: "stopped" } : agent));
  // a choice
  fireEvent.click(within(answers).getAllByTestId("oats-needs-choice")[0]!);
  const refused = await within(answers).findByRole("alert");
  expect(refused.querySelector("h3")!.textContent).toBe("The answer was not sent");
  // SAFETY: why nothing went is the card's one line, in view (never only behind a fold: a person would press again).
  expect(refused.textContent).toBe("The answer was not sentOATS has stopped this agent since: nothing was sent. Start it to answer.");
  expect(within(refused).getByTestId("oats-needs-why").closest("details")).toBeNull();
  // a reply
  fireEvent.click(within(writes).getByTestId("oats-reply-send"));
  const unsent = await within(writes).findByRole("alert");
  expect(unsent.querySelector("h3")!.textContent).toBe("The message was not sent");
  expect(unsent.textContent).toBe("The message was not sentOATS has stopped this agent since: nothing was sent. Start it to answer.");
  expect(within(unsent).getByTestId("oats-needs-why").closest("details")).toBeNull();
  expect((within(writes).getByTestId("oats-reply-text") as HTMLTextAreaElement).value).toBe("keep depth 6"); // what was written is kept
  // nothing went to bb: not an answer, not a message
  expect(slot.inspection.sdkCalls.filter((call) => call.method !== "threads.interactions.list")).toEqual([]);
});

test("a press while the server holds no roster that reads sends nothing either: whether the agent still runs is not known", async () => {
  let failing = false;
  const slot = await homePage({
    rpc: handlers({ snapshot: () => (failing ? { ok: false as const, at: "t", code: "OATS_TIMEOUT", message: "oats did not answer" } : fixtureSnapshot()) }),
    sdk: BB_ASKS,
  });
  const card = await cardOf(slot, "flaky-ci-developer");
  await waitFor(() => expect(within(card).getAllByTestId("oats-needs-choice")).toHaveLength(2));
  failing = true;
  fireEvent.click(within(card).getAllByTestId("oats-needs-choice")[1]!);
  const notSent = await within(card).findByRole("alert");
  expect(notSent.textContent).toBe("The answer was not sentOATS cannot be read now, so nothing was sent: whether this agent still runs is not known.");
  expect(within(notSent).getByTestId("oats-needs-why").closest("details")).toBeNull();
  expect(slot.inspection.sdkCalls.filter((call) => call.method !== "threads.interactions.list")).toEqual([]);
});

test("a press on an agent the roster no longer names sends nothing, and says that, not that it was stopped", async () => {
  let agents = fixtureAgents();
  const slot = await homePage({ rpc: handlers({ snapshot: () => fixtureSnapshot(agents) }), sdk: BB_ASKS });
  const card = await cardOf(slot, "flaky-ci-developer");
  await waitFor(() => expect(within(card).getAllByTestId("oats-needs-choice")).toHaveLength(2));
  // retired since the card was drawn, and nothing has told this window yet
  agents = agents.filter((agent) => agent.instance !== "flaky-ci-developer");
  fireEvent.click(within(card).getAllByTestId("oats-needs-choice")[0]!);
  const refused = await within(card).findByRole("alert");
  expect(refused.textContent).toBe("The answer was not sentOATS no longer lists this agent: nothing was sent.");
  expect(within(refused).getByTestId("oats-needs-why").closest("details")).toBeNull();
  expect(refused.textContent).not.toContain("Start it");
  expect(slot.inspection.sdkCalls.filter((call) => call.method !== "threads.interactions.list")).toEqual([]);
});
