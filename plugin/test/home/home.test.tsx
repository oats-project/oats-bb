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
  const card = await cardOf(slot, "flaky-ci-developer");
  const text = within(card).getByLabelText("Reply to Flaky ci developer") as HTMLTextAreaElement;
  expect(text.placeholder).toBe("Write to Flaky ci developer…");
  const send = within(card).getByTestId("oats-reply-send") as HTMLButtonElement;
  expect(send.disabled).toBe(true);
  fireEvent.change(text, { target: { value: "  Use the darker palette.  " } });
  fireEvent.click(send);
  await waitFor(() => expect(text.value).toBe(""));
  expect(within(card).getByTestId("oats-reply-sent").textContent).toBe("Sent to Flaky ci developer.");
  expect(slot.inspection.sdkCalls.filter((call) => call.method !== "threads.interactions.list")).toEqual([
    { method: "threads.send", args: [{ threadId: "thr_ci", mode: "auto", input: [{ type: "text", text: "Use the darker palette.", mentions: [] }] }] },
  ]);
  // No reply stands apart from a card: every box is inside the card of the agent it writes to.
  for (const box of slot.getAllByTestId("oats-reply")) expect(box.closest('[data-testid="oats-needs-card"]')).not.toBeNull();
  expect(slot.inspection.rpcCalls.map((call) => call.method).filter((method) => !["snapshot", "souls", "capabilities", "teams", "machines"].includes(method))).toEqual([]); // reads only: never an OATS act
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
  const card = await cardOf(slot, "flaky-ci-developer");
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
  const card = await cardOf(slot, "flaky-ci-developer");
  fireEvent.change(within(card).getByTestId("oats-reply-text"), { target: { value: "yes, force-push it" } });
  // another agent now waits too
  agents = fixtureAgents();
  await slot.behavior.emitRealtime("oats/changed", { at: "2026-11-19T12:45:00.000Z" });
  await waitFor(() => expect(slot.getAllByTestId("oats-needs-card").map((each) => each.dataset.instance)).toContain("release-070-maintainer"));
  const still = await cardOf(slot, "flaky-ci-developer");
  expect((within(still).getByTestId("oats-reply-text") as HTMLTextAreaElement).value).toBe("yes, force-push it");
  expect((within(await cardOf(slot, "release-070-maintainer")).getByTestId("oats-reply-text") as HTMLTextAreaElement).value).toBe("");
  fireEvent.click(within(still).getByTestId("oats-reply-send"));
  await waitFor(() => expect(slot.inspection.sdkCalls.filter((call) => call.method === "threads.send")).toHaveLength(1));
  expect((slot.inspection.sdkCalls.find((call) => call.method === "threads.send")!.args[0] as { threadId: string }).threadId).toBe("thr_ci");
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
    const before = slot.inspection.rpcCalls.length;
    await act(async () => {
      vi.advanceTimersByTime(18 * 60_000);
    });
    expect(slot.getAllByTestId("oats-needs-card")[0]!.textContent).toContain("waiting 18 min (since ");
    expect(slot.inspection.rpcCalls.length).toBe(before); // the clock alone: no reread
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
  const card = await cardOf(slot, "flaky-ci-developer");
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
