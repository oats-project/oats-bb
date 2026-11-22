// @vitest-environment jsdom
// A10: the OATS home (navPanel `home`, and the fixed thread tab) and its badge.
import { afterEach, expect, test, vi } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import type { ComponentType } from "react";
import type { ExperimentalBadge, ExperimentalThreadTabProps } from "@get-bb/plugin-sdk/app";
import { fixtureAgents, fixtureSnapshot } from "../helpers/fixtures";
import { handlers, loadApp, resetApp, sidebarThreads } from "../helpers/render";
import type { Contract, Handlers } from "../helpers/render";
import { setAgentTab } from "../../app/home/agent-tab";
import type { Agent } from "../../model/types";

afterEach(resetApp);

const quiet = (): Agent[] =>
  fixtureAgents().map((agent) => ({ ...agent, waiting: null, running: agent.running === true ? null : agent.running }));
const calm = () => {
  const threads = sidebarThreads();
  return { ...threads, threads: threads.threads.map((thread) => ({ ...thread, hasPendingInteraction: false, isUnread: false })) };
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

test("what needs you first, then the summary, the tiles, who works and what is finished and not looked at", async () => {
  const slot = await homePage();
  const needs = await slot.findByTestId("oats-home-needs");
  expect(heading(needs)).toBe("Needs you3");
  expect(within(needs).getAllByTestId("oats-needs-card")).toHaveLength(3);
  expect(slot.getByTestId("oats-home-title").textContent).toBe("Home");
  // every agent OATS has is counted once, the ones with no bb thread among them
  const total = fixtureAgents().length;
  expect(slot.getByTestId("oats-home-summary").textContent).toMatch(new RegExp(`^${total} agents · \\d+ working · 3 need you`));
  const numbers = slot.getByTestId("oats-home-summary").textContent!.split(" · ").slice(1).map((part) => Number(part.split(" ")[0]));
  expect(numbers.reduce((sum, n) => sum + n, 0)).toBe(total);
  const working = slot.getByTestId("oats-home-working");
  expect(heading(working)).toBe(`Working${within(working).getAllByTestId("oats-working-row").length}`);
  for (const row of within(working).getAllByTestId("oats-working-row")) expect(within(row).getByTestId("oats-state").textContent).toContain("Working");
  const finished = slot.getByTestId("oats-home-finished");
  expect(heading(finished)).toBe("Finished, not looked at1");
  expect(within(finished).getAllByTestId("oats-finished-row").map((row) => row.dataset.instance)).toEqual(["harvest-knowledge-helper"]);
  // in the page's order: what needs the person comes before everything else
  const order = ["oats-home-needs", "oats-home-summary", "oats-home-tiles", "oats-home-working", "oats-home-finished"].map((id) => slot.getByTestId(id));
  for (let i = 1; i < order.length; i++) expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("a card says who (the name as words, the soul, the machine), what it asks and since when; its name and Open lead to its thread", async () => {
  const slot = await homePage();
  const release = await cardOf(slot, "release-070-maintainer");
  expect(within(release).getByTestId("oats-needs-name").textContent).toBe("Release 070 maintainer");
  expect(release.textContent).toContain(" · falcon");
  expect(within(release).getByTestId("oats-state").textContent).toContain("Needs you");
  expect(within(release).getByTestId("oats-needs-question").textContent).toBe("Green light at 9f2e1c? Second reader done.");
  fireEvent.click(within(release).getByTestId("oats-needs-open"));
  fireEvent.click(within(slot.getByTestId("oats-home-working")).getAllByTestId("oats-home-agent")[0]!);
  expect(slot.inspection.navigateCalls.map((call) => call.method)).toEqual(["toThread", "toThread"]);
  expect(slot.inspection.navigateCalls[0]).toEqual({ method: "toThread", threadId: "thr_release" });
});

test('with none: "Nothing needs you.", the summary still says the two counts a person looks for, and an empty group is not drawn', async () => {
  const slot = await homePage({ rpc: handlers({}, quiet()), sidebarThreads: calm() });
  const needs = await slot.findByTestId("oats-home-needs");
  expect(needs.textContent).toBe("Needs you0Nothing needs you.");
  expect(slot.getByTestId("oats-home-summary").textContent).toContain(" · 0 working · 0 need you");
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
  expect(refused.textContent).toContain("interaction is no longer pending");
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
  expect(within(card).getByTestId("oats-reply-sent").textContent).toBe("Sent to Ranker v3 probe.");
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
  expect(notice.textContent).toContain("thread is archived");
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

test("the tiles: Agents and the plugin's pages, each with its count, each leading to its page", async () => {
  const slot = await plainTab();
  expect(heading(await slot.findByTestId("oats-home-needs"))).toBe("Needs you3");
  expect(slot.getByTestId("oats-tile-agents").textContent).toBe(`Agents${fixtureAgents().length}`);
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
    expect(card.textContent).toContain("waiting under a minute (since "); // the Desktop's words for how long, and since when
    // The Automations tile's mark is the automations feature's own read, on that feature's own clock: not the home's.
    const homes = () => slot.inspection.rpcCalls.filter((call) => call.method !== "automations").length;
    const before = homes();
    await act(async () => {
      vi.advanceTimersByTime(18 * 60_000);
    });
    expect(slot.getAllByTestId("oats-needs-card")[0]!.textContent).toContain("waiting 18 min (since ");
    expect(homes()).toBe(before); // the clock alone: no reread of the home's
  } finally {
    vi.useRealTimers();
  }
});

test("a kernel refusal of the snapshot: what happened in words, who says it, the kernel's code after the words", async () => {
  const slot = await homePage({
    rpc: handlers({ snapshot: () => ({ ok: false, at: "t", code: "E_WORKSPACE_INVALID", message: "oats-workspace.yaml: unknown key `foo`\nsee docs" }) }),
  });
  const notice = await slot.findByRole("alert");
  expect(notice.querySelector("h3")!.textContent).toBe("OATS could not read this deployment");
  expect(notice.textContent).toContain("OATS says: oats-workspace.yaml: unknown key `foo`");
  const words = notice.textContent!;
  expect(words.indexOf("E_WORKSPACE_INVALID")).toBeGreaterThan(words.indexOf("OATS says"));
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
  const last = { at: new Date(Date.now() - 2 * 60_000 - 5_000).toISOString(), deployment: { root: "/abs/deployment", workspace: "oats", machine: "falcon" }, agents: fixtureAgents() };
  const slot = await homePage({
    rpc: handlers({ snapshot: () => ({ ok: false, at: new Date().toISOString(), code: "OATS_TIMEOUT", message: "`oats` did not answer within 20 s and was stopped", last }) }),
  });
  const notice = await slot.findByRole("alert");
  expect(notice.querySelector("h3")!.textContent).toBe("OATS did not answer on falcon");
  expect(notice.textContent).toContain("Showing what was read 2 min ago.");
  expect(slot.getByTestId("oats-home-needs").textContent).toContain("Needs you");
  expect(slot.getAllByTestId("oats-needs-card").length).toBeGreaterThan(0);
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

test("Home › Agents: every agent OATS has, in the sidebar's order, each with its state and who started it, and the way back", async () => {
  const agents = [...fixtureAgents(), TMUX_ASKS];
  const slot = await homePage({ rpc: handlers({}, agents) });
  fireEvent.click(await slot.findByTestId("oats-tile-agents"));
  // the page's Home › Agents has its own address
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "home", options: { subPath: "agents" } }]);
  slot.unmount();

  const app = await loadApp();
  const panel = app.navPanels.find((candidate) => candidate.id === "home")!;
  const list = renderSlot<{ subPath: string }, Contract>(panel, { subPath: "agents" }, { rpc: handlers({}, agents), sidebarThreads: sidebarThreads(), sdk: NO_INTERACTIONS });
  const section = await list.findByTestId("oats-home-agents");
  expect(heading(section)).toBe(`Every agent${agents.length}`);
  const rows = within(section).getAllByTestId("oats-home-agent-row");
  // every agent, the stopped ones, the ones whose thread is gone and the ones on tmux among them
  expect(rows.map((row) => row.dataset.instance).sort()).toEqual(agents.map((agent) => agent.instance).sort());
  for (const row of rows) expect(within(row).getByTestId("oats-state").textContent).not.toBe("");
  const tmux = rows.find((row) => row.dataset.instance === "night-watch-helper")!;
  expect(rows.indexOf(tmux)).toBe(rows.length - 1); // after the tree, as in the sidebar
  expect(within(tmux).getByTestId("oats-home-agent").textContent).toBe("Night watch helper");
  expect(tmux.textContent).toContain("runs in tmux · started by Ana");
  expect(within(tmux).getByTestId("oats-state").textContent).toContain("Needs you");
  // no card and no reply here: the list says who there is
  expect(list.queryByTestId("oats-needs-card")).toBeNull();
  const back = list.getByTestId("oats-home-back");
  expect(back.textContent).toBe("‹ Back to Home");
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

test("in the thread's tab Home › Agents is a view of the tab: Agents opens it and Back to Home closes it", async () => {
  const slot = await plainTab();
  fireEvent.click(await slot.findByTestId("oats-tile-agents"));
  expect(heading(await slot.findByTestId("oats-home-agents"))).toBe(`Every agent${fixtureAgents().length}`);
  expect(slot.queryByTestId("oats-home-needs")).toBeNull();
  expect(slot.inspection.navigateCalls).toEqual([]);
  fireEvent.click(slot.getByTestId("oats-home-back"));
  expect(await slot.findByTestId("oats-home-needs")).toBeTruthy();
});

test("an agent with no bb thread that needs the person has its card: what it asks, where to answer it, Open to its own page, and no reply", async () => {
  let opened: string | null = null;
  const { setAgentPage } = await import("../../app/home/agent-tab");
  const slot = await homePage({ rpc: handlers({}, [...fixtureAgents(), TMUX_ASKS]) });
  setAgentPage((_navigate, instance) => void (opened = instance));
  try {
    const card = await cardOf(slot, "night-watch-helper");
    expect(heading(slot.getByTestId("oats-home-needs"))).toBe("Needs you4");
    expect(within(card).getByTestId("oats-needs-question").textContent).toBe("Which branch do I watch?");
    // where it runs is on its line, as in every list; then where to answer it, with the kernel's own command to copy, and where Open leads
    expect(card.textContent).toContain(" · falcon · runs in tmux");
    expect(within(card).getByTestId("oats-needs-elsewhere").textContent).toBe(
      `It runs in tmux on falcon, where bb cannot write to it. Answer it in its terminal there:oats session attach --home ${TMUX_ASKS.home}CopyOpen its page shows who it is and how it runs.`,
    );
    expect(within(card).getByRole("button", { name: "Copy the command" })).toBeTruthy();
    expect(within(card).getByTestId("oats-needs-open").textContent).toBe("Open its page");
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
  expect(heading(working)).toBe("Working7");
  expect(within(working).getAllByTestId("oats-working-row")).toHaveLength(5);
  fireEvent.click(within(working).getByTestId("oats-home-working-all"));
  expect(within(working).getAllByTestId("oats-working-row")).toHaveLength(7);
});

test("a workspace with no agent says what OATS does in two lines, and New agent is the one act, in the heading's row", async () => {
  const slot = await homePage({ rpc: handlers({}, []), sidebarThreads: calm() });
  const empty = await slot.findByTestId("oats-empty");
  expect(empty.textContent).toBe("OATS runs your agents: each one is a soul at work on a machine of yours.Start one, and Home shows what needs you and what you have.");
  // the one act of that home is New agent, in the heading's row, drawn as the thing to press
  expect(slot.getByTestId("oats-home-head").textContent).toBe("HomeNew agent");
  expect(slot.queryByTestId("oats-home-needs")).toBeNull();
  expect(slot.queryByTestId("oats-home-summary")).toBeNull();
  fireEvent.click(slot.getByTestId("oats-home-new-agent"));
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "souls" }]);
});

test("while what is shown is the roster as last read, a card's answers and its reply are held, and it says why; Open still opens", async () => {
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
  expect(within(card).getAllByTestId("oats-disabled-reason")[0]!.textContent).toBe("Held until OATS is read again: what is shown may have changed.");
  // a card answered by a reply holds it too
  const asks = await cardOf(slot, "ranker-v3-probe");
  expect((within(asks).getByTestId("oats-reply-text") as HTMLTextAreaElement).disabled).toBe(true);
  expect((within(asks).getByTestId("oats-reply-send") as HTMLButtonElement).disabled).toBe(true);
  expect(within(asks).getByTestId("oats-disabled-reason").textContent).toBe("Held until OATS is read again: what is shown may have changed.");
  expect((within(card).getByTestId("oats-needs-open") as HTMLButtonElement).disabled).toBe(false);
  // the one notice of the roster's, once
  expect(slot.getAllByRole("alert")).toHaveLength(1);
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

test("a first version read that fails: the home tries once more by itself once the roster is read; still failing, one line says so, with Check again; New agent stays on", async () => {
  let failing = true;
  const slot = await homePage({
    rpc: {
      ...handlers(),
      homeCli: () => {
        if (failing) throw new Error("OATS_TIMEOUT: oats did not answer");
        return { version: "0.70.0", desktopApi: 1, state: "tested" as const };
      },
    } as Handlers,
  });
  await slot.findByTestId("oats-home-needs");
  const asked = () => slot.inspection.rpcCalls.filter((call) => call.method === "homeCli").length;
  // it failed, and was tried once more, by itself, and no more than that
  const line = await slot.findByTestId("oats-home-cli-unchecked");
  expect(asked()).toBe(2);
  expect(line.textContent).toBe("The installed oats could not be checked.Check again");
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(asked()).toBe(2);
  // not drawn as a failure of the roster's, and the act that makes an agent is not turned off for it
  expect(slot.queryByRole("alert")).toBeNull();
  expect(slot.queryByTestId("oats-home-cli")).toBeNull();
  expect((slot.getByTestId("oats-home-new-agent") as HTMLButtonElement).disabled).toBe(false);
  // Check again: the version reads, and the line goes
  failing = false;
  fireEvent.click(slot.getByTestId("oats-home-cli-retry"));
  await waitFor(() => expect(slot.queryByTestId("oats-home-cli-unchecked")).toBeNull());
  expect(asked()).toBe(3);
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
  expect(card.textContent).toContain("Everything the plugin shows and does runs through the installed oats CLI.");
  expect(within(card).getAllByTestId("oats-fact").map((fact) => fact.textContent)).toEqual(["Detected0.69.4", "Required0.70.0 or newer, with desktop API 1"]);
  expect(card.querySelector("code")!.textContent).toBe("npm install -g @awebai/oats@0.70");
  expect(within(card).getByRole("button", { name: "Copy install command" })).toBeTruthy();
  // the card comes before what needs the person, and the roster is still drawn
  expect(card.compareDocumentPosition(slot.getByTestId("oats-home-needs")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("an oats whose version cannot be read gets the same card, and says so", async () => {
  const slot = await withCli({ version: null, desktopApi: null, state: "unknown" });
  const card = await slot.findByTestId("oats-home-cli");
  expect(card.querySelector("h3")!.textContent).toBe("Compatible oats CLI required");
  expect(within(card).getAllByTestId("oats-fact")[0]!.textContent).toBe("Detectedunknown: oats answered no version the plugin can read");
});

test("an oats that speaks a newer desktop API: the card names the plugin as the older one and offers no npm command", async () => {
  const slot = await withCli({ version: "0.74.0", desktopApi: 2, state: "newer-api" });
  const card = await slot.findByTestId("oats-home-cli");
  expect(card.querySelector("h3")!.textContent).toBe("This plugin is older than the installed oats CLI");
  expect(card.textContent).toContain("The installed oats CLI is 0.74.0, which speaks a newer desktop API (2) than this plugin's (1). Update the OATS plugin to use it.");
  expect(card.querySelector("code")).toBeNull();
  expect(card.textContent).not.toContain("npm");
  // no command to copy: the one thing to press asks again, after the plugin was updated
  expect(within(card).getAllByRole("button").map((button) => button.textContent)).toEqual(["Check again"]);
});

test("an oats of a later minor than the plugin was tested with: one line, no card, and nothing is turned off", async () => {
  const slot = await withCli({ version: "0.71.2", desktopApi: 1, state: "newer" }, []);
  expect((await slot.findByTestId("oats-home-cli-line")).textContent).toBe("This plugin was tested with oats CLIs up to 0.70; the installed CLI is 0.71.2.Check again");
  expect(slot.queryByTestId("oats-home-cli")).toBeNull();
  expect((slot.getByTestId("oats-home-new-agent") as HTMLButtonElement).disabled).toBe(false);
});

test("behind the card New agent is off, and says why", async () => {
  const slot = await withCli({ version: "0.69.4", desktopApi: 1, state: "older" }, []);
  await slot.findByTestId("oats-home-cli");
  const button = slot.getByTestId("oats-home-new-agent") as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(slot.getByTestId("oats-disabled-reason").textContent).toBe("Off until a compatible oats CLI is installed.");
  fireEvent.click(button);
  expect(slot.inspection.navigateCalls).toEqual([]);
});

test("the release's default shows the home alone: the Agents tile only, no count read for a page that is not shown, and no New agent with nowhere to open", async () => {
  const slot = await homePage({ settings: { pages: "home" } });
  await slot.findByTestId("oats-home-needs");
  expect(Array.from(slot.getByTestId("oats-home-tiles").querySelectorAll("button")).map((tile) => tile.dataset.testid)).toEqual(["oats-tile-agents"]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(slot.inspection.rpcCalls.map((call) => call.method).filter((method) => ["capabilities", "teams", "machines"].includes(method))).toEqual([]);
  slot.unmount();
  const some = await homePage({ settings: { pages: "home, teams" } });
  await some.findByTestId("oats-home-needs");
  expect(Array.from(some.getByTestId("oats-home-tiles").querySelectorAll("button")).map((tile) => tile.dataset.testid)).toEqual(["oats-tile-agents", "oats-tile-teams"]);
  some.unmount();
  const empty = await homePage({ rpc: handlers({}, []), sidebarThreads: calm(), settings: { pages: "home" } });
  await empty.findByTestId("oats-empty");
  expect(empty.queryByTestId("oats-home-new-agent")).toBeNull();
});

test("the home's count of who needs you is the sidebar's: an agent on tmux that asks is in the badge, the heading and the summary", async () => {
  const agents = [...fixtureAgents(), TMUX_ASKS];
  const latest = await badge({ rpc: handlers({}, agents) });
  await waitFor(() => expect(latest()).toEqual({ count: 4, tone: "warning", label: "4 agents need you" }));
  const slot = await homePage({ rpc: handlers({}, agents) });
  expect(heading(await slot.findByTestId("oats-home-needs"))).toBe("Needs you4");
  expect(slot.getByTestId("oats-home-summary").textContent).toContain(" · 4 need you");
});

// ---- what a card offers, by what its agent asks (the lead's ruling on the home's UX read)

const offerOf = (card: HTMLElement) => card.dataset.offer;
/** Whether an element is inside a fold that a person has to open first. */
const folded = (element: HTMLElement) => element.closest("details") !== null && !(element.closest("details") as HTMLDetailsElement).open;

test("an agent that asks in its own words is answered by the reply, on its card; one that waits for an approval is not", async () => {
  const slot = await homePage({ sidebarThreads: calm() }); // bb lists no pending request for any thread
  const asks = await cardOf(slot, "ranker-v3-probe");
  expect(offerOf(asks)).toBe("reply");
  expect(within(asks).getByTestId("oats-reply-text").closest("details")).toBeNull();
  expect(within(asks).getByTestId("oats-needs-open").textContent).toBe("Open thread");
  // The kernel says it waits for a tool approval, and bb lists no request to answer: the answer is in its thread.
  const permission = await cardOf(slot, "flaky-ci-developer");
  expect(offerOf(permission)).toBe("in-thread");
  expect(within(permission).getByTestId("oats-needs-in-thread").textContent).toBe("It waits for an approval, and bb lists no request to answer here: open its thread to see what it waits for.");
  // a message is not offered beside it as an equal: it is behind a fold, with what a message does not do
  const fold = within(permission).getByTestId("oats-needs-message");
  expect(fold.querySelector("summary")!.textContent).toContain("Write a message instead");
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
  expect((await within(card).findByTestId("oats-needs-answered")).textContent).toBe("Answered: Allow. Waiting for the agent to go on.");
  expect(offerOf(card)).toBe("answered");
  expect(within(card).queryAllByTestId("oats-needs-choice")).toEqual([]);
  expect(within(card).queryByTestId("oats-reply")).toBeNull();
  expect(within(card).queryByTestId("oats-needs-in-thread")).toBeNull();
  expect(Array.from(card.querySelectorAll("button")).map((button) => button.textContent)).toEqual(["Open thread"]);
});

test("a request bb shows in a form the card cannot draw is answered in the thread, and the card says so", async () => {
  const slot = await homePage({
    sdk: { threads: { interactions: { list: async () => [{ id: "pint_4", threadId: "thr_ci", status: "pending", payload: { kind: "plugin", title: "A plugin's form", data: {} } }] as never } } },
  });
  const card = await cardOf(slot, "flaky-ci-developer");
  await waitFor(() => expect(slot.inspection.sdkCalls.length).toBeGreaterThan(0));
  expect(offerOf(card)).toBe("in-thread");
  expect(within(card).getByTestId("oats-needs-in-thread").textContent).toBe("bb shows its request in its thread: open the thread to answer it.");
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

test("an agent OATS says is stopped that still carries a claim: the card shows bb's question, and nothing of the dead claim", async () => {
  // The claim through the one gate (`claimOf`): the row and the panel say nothing of it either.
  const agents = fixtureAgents().map((agent) => (agent.instance === "flaky-ci-developer" ? { ...agent, running: false as const, runtimeState: "stopped" } : agent));
  expect(agents.find((agent) => agent.instance === "flaky-ci-developer")!.waiting?.message).toBe("needs your permission to use Bash");
  const slot = await homePage({
    rpc: handlers({}, agents),
    sdk: {
      threads: {
        interactions: {
          list: async () =>
            [{ id: "pint_s", threadId: "thr_ci", status: "pending", payload: { kind: "user_question", questions: [{ id: "q", prompt: "Which shard do I rerun?", multiSelect: false, allowFreeText: false, options: [{ label: "One", value: "1" }, { label: "Two", value: "2" }] }] } }] as never,
        },
      },
    },
  });
  const card = await cardOf(slot, "flaky-ci-developer");
  await waitFor(() => expect(within(card).getAllByTestId("oats-needs-choice").map((choice) => choice.textContent)).toEqual(["One", "Two"]));
  expect(within(card).getByTestId("oats-needs-question").textContent).toBe("Which shard do I rerun?");
  expect(within(card).queryByTestId("oats-needs-detail")).toBeNull();
  expect(card.textContent).not.toContain("needs your permission to use Bash");
  expect(card.dataset.offer).toBe("choices");
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
  expect((await within(card).findByTestId("oats-needs-answered")).textContent).toBe("Answered: Allow. Waiting for the agent to go on.");
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
  expect(slot.getByTestId("oats-home-cli-check-failed").textContent).toBe("The installed oats could not be checked again: OATS_TIMEOUT: oats did not answer");
});

test("New agent is on every home, in the heading's row: with agents too, on the page and in the tab; held with its reason while the roster is the last one read", async () => {
  const slot = await homePage();
  await slot.findByTestId("oats-home-needs");
  const head = slot.getByTestId("oats-home-head");
  expect(head.textContent).toBe("HomeNew agent");
  // above everything else of the home
  expect(head.compareDocumentPosition(slot.getByTestId("oats-home-needs")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(slot.getByTestId("oats-home-new-agent"));
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "souls" }]);
  slot.unmount();
  // Home › Agents keeps it
  const app = await loadApp();
  const panel = app.navPanels.find((candidate) => candidate.id === "home")!;
  const list = renderSlot<{ subPath: string }, Contract>(panel, { subPath: "agents" }, { rpc: handlers(), sidebarThreads: sidebarThreads(), sdk: NO_INTERACTIONS });
  await list.findByTestId("oats-home-agents");
  expect(list.getByTestId("oats-home-new-agent")).toBeTruthy();
  list.unmount();
  // the tab has bb's own heading: the row holds the button alone
  const tab = await plainTab();
  await tab.findByTestId("oats-home-needs");
  expect(tab.getByTestId("oats-home-head").textContent).toBe("New agent");
  expect(tab.queryByTestId("oats-home-title")).toBeNull();
  tab.unmount();
  // the roster as last read: off, and it says why
  const last = { at: new Date(Date.now() - 2 * 60_000).toISOString(), deployment: { root: "/abs/deployment", workspace: "oats", machine: "falcon" }, agents: fixtureAgents() };
  const stale = await homePage({ rpc: handlers({ snapshot: () => ({ ok: false, at: new Date().toISOString(), code: "OATS_TIMEOUT", message: "`oats` did not answer within 20 s and was stopped", last }) }) });
  await stale.findByTestId("oats-home-needs");
  expect((stale.getByTestId("oats-home-new-agent") as HTMLButtonElement).disabled).toBe(true);
  expect(within(stale.getByTestId("oats-home-head")).getByTestId("oats-disabled-reason").textContent).toBe("Held until OATS is read again: what is shown may have changed.");
  stale.unmount();
  // where New agent has nowhere to open (the default pages, and no form's page named), it is not drawn
  const nowhere = await homePage({ settings: { pages: "home" } });
  await nowhere.findByTestId("oats-home-needs");
  expect(nowhere.queryByTestId("oats-home-new-agent")).toBeNull();
  expect(nowhere.getByTestId("oats-home-head").textContent).toBe("Home");
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
  // the roster reads: now the one more try is made, and, failing too, the line is drawn
  rosterFails = false;
  await act(async () => {
    await slot.behavior.emitRealtime("oats/changed", { at: "2026-11-19T12:55:00.000Z" });
  });
  await slot.findByTestId("oats-home-needs");
  expect((await slot.findByTestId("oats-home-cli-unchecked")).textContent).toBe("The installed oats could not be checked.Check again");
  expect(asked()).toBe(2);
});
