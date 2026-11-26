// @vitest-environment jsdom
// Where the mail stands: ONE control, the tab "Mail" of an agent's panel (D-132). Drawn only for
// an agent the roster gives a messaging id; never remembered from one agent to the next, so that
// no agent's mail is read without a press on its own tab.
import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { InstancePanel } from "../../app/panel/Panel";
import { handlers, resetApp } from "../helpers/render";
import type { Contract, Handlers } from "../helpers/render";
import { instanceAnswer, panelAgents, panelSnapshot, panelThreads } from "../panel/handlers";
import { recordedMail } from "./handlers";

afterEach(() => {
  resetApp();
  vi.useRealTimers();
});

const NOW = Date.parse("2026-11-25T12:15:00.000Z");
const CHILD = "panel-worktree-helper";
const PARENT = "redesign-ui-lead";
const threadOf = (instance: string): string => panelAgents().find((agent) => agent.instance === instance)?.threadId ?? "";
const text = (element: Element | null) => element?.textContent ?? "";

/** The panel, for a thread a test changes: bb shows another agent's thread. */
let showThread: (threadId: string) => void = () => undefined;
function Shown({ threadId }: { threadId: string }) {
  const [now, setNow] = useState(threadId);
  showThread = setNow;
  return <InstancePanel threadId={now} />;
}
/** `messaging`: the instances whose roster row gives a messaging id (the recorded roster's rows give none). */
function panel(messaging: readonly string[], over: Partial<Handlers> = {}) {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  return renderSlot<{ threadId: string }, Contract>({ component: Shown }, { threadId: threadOf(CHILD) }, {
    rpc: handlers({
      snapshot: () => panelSnapshot(),
      panelInstance: ({ instance }) => instanceAnswer(instance, (facts) => ({ ...facts, messagingId: messaging.includes(instance) ? `mailspike.test/${instance}` : null })),
      ...over,
    }),
    sidebarThreads: panelThreads(),
  });
}
const tabs = (slot: { getByRole(role: string, options: { name: string }): HTMLElement }) => within(slot.getByRole("tablist", { name: "Instance context" })).getAllByRole("tab").map((tab) => `${text(tab)} ${tab.getAttribute("aria-selected")}`);
const reads = (slot: { inspection: { rpcCalls: { method: string; input: unknown }[] } }) => slot.inspection.rpcCalls.filter((call) => call.method === "mail").map((call) => call.input);

test("an agent with a messaging id: the tab Mail, the last of the four; nothing of its mail is read until the tab is pressed, and then it is", async () => {
  const slot = panel([CHILD]);
  await slot.findByTestId("oats-tab-mail");
  expect(tabs(slot)).toEqual(["Board false", "Instance true", "Soul false", "Mail false"]);
  expect(reads(slot)).toEqual([]);
  fireEvent.click(slot.getByTestId("oats-tab-mail"));
  await slot.findByTestId("oats-mail-list");
  expect(tabs(slot)).toEqual(["Board false", "Instance false", "Soul false", "Mail true"]);
  expect(slot.getByRole("tabpanel").getAttribute("data-testid")).toBe("oats-panel-page-mail");
  expect(reads(slot)).toEqual([{ instance: CHILD, older: null }]);
});

test("an agent with no messaging id: the Mail tab is there (every agent's panel has the four tabs), and it says No messaging. from the row alone: no mail is read", async () => {
  const slot = panel([]);
  await slot.findByTestId("oats-panel-work");
  expect(tabs(slot)).toEqual(["Board false", "Instance true", "Soul false", "Mail false"]);
  fireEvent.click(slot.getByTestId("oats-tab-mail"));
  await waitFor(() => expect(slot.getByRole("tabpanel").textContent).toBe("No messaging."));
  expect(slot.queryByTestId("oats-mail")).toBeNull(); // the mail's view is not mounted: nothing is read
  await act(async () => {});
  expect(reads(slot)).toEqual([]);
});

test("Mail is not remembered: left on Mail, another agent's panel opens on Instance, and that agent's mail is not read without a press", async () => {
  const slot = panel([CHILD, PARENT]);
  fireEvent.click(await slot.findByTestId("oats-tab-mail"));
  await slot.findByTestId("oats-mail-list");
  act(() => showThread(threadOf(PARENT)));
  await waitFor(() => expect(slot.getByTestId("oats-panel-name").getAttribute("title")).toBe(PARENT));
  await slot.findByTestId("oats-tab-mail");
  expect(tabs(slot)).toEqual(["Board false", "Instance true", "Soul false", "Mail false"]);
  expect(slot.getByRole("tabpanel").getAttribute("data-testid")).toBe("oats-panel-page-instance");
  expect(slot.queryByTestId("oats-mail")).toBeNull();
  expect(reads(slot)).toEqual([{ instance: CHILD, older: null }]);
  // A press on THIS agent's tab reads its mail.
  fireEvent.click(slot.getByTestId("oats-tab-mail"));
  await slot.findByTestId("oats-mail-list");
  expect(reads(slot)).toEqual([{ instance: CHILD, older: null }, { instance: PARENT, older: null }]);
  // And back at the first agent: Instance again.
  act(() => showThread(threadOf(CHILD)));
  await waitFor(() => expect(slot.getByTestId("oats-panel-name").getAttribute("title")).toBe(CHILD));
  expect(tabs(slot)).toEqual(["Board false", "Instance true", "Soul false", "Mail false"]);
  expect(reads(slot)).toHaveLength(2);
});

test("the other tabs are still remembered: left on Soul, another agent opens on Soul", async () => {
  const slot = panel([CHILD, PARENT]);
  fireEvent.click(await slot.findByTestId("oats-tab-soul"));
  act(() => showThread(threadOf(PARENT)));
  await waitFor(() => expect(slot.getByTestId("oats-panel-name").getAttribute("title")).toBe(PARENT));
  expect(tabs(slot).slice(0, 3)).toEqual(["Board false", "Instance false", "Soul true"]);
});

test("the row says messaging and the read says none: the tab is drawn, and it says the one line, No messaging.", async () => {
  const slot = panel([CHILD], {
    mail: () => {
      throw new Error("E_OPERATION_UNAVAILABLE: no messaging provider is resolved for /abs/deployment/agents/oats-expert/instances/panel-worktree-helper");
    },
  });
  fireEvent.click(await slot.findByTestId("oats-tab-mail"));
  const notice = await slot.findByTestId("oats-notice");
  expect(text(notice.querySelector("h3"))).toBe("No messaging.");
  expect(within(notice).getByTestId("oats-mail-retry")).toBeTruthy();
});

test("the mail's view is given the agent's name and reads for it alone", async () => {
  const slot = panel([CHILD], { mail: ({ instance }) => recordedMail(instance === CHILD ? "mail-none.json" : "mail.json") });
  fireEvent.click(await slot.findByTestId("oats-tab-mail"));
  expect(text(await slot.findByTestId("oats-mail-empty"))).toBe("No mail.");
});
