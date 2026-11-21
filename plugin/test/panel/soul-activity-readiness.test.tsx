// @vitest-environment jsdom
// The Soul tab's body (D-141, D-196), the recorded lifecycle activity (D-150) and readiness
// (D-151), drawn from the answers recorded from the real kernel.
import { afterEach, expect, test, vi } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import { InstancePanel, showPanelTab } from "../../app/panel/Panel";
import type { PanelSoul } from "../../kernel/panel-soul";
import { handlers, resetApp } from "../helpers/render";
import type { Contract, Handlers } from "../helpers/render";
import { instanceAnswer, panelSnapshot, panelThreads, recordedEvents, recordedReadiness, recordedSoul } from "./handlers";

afterEach(() => {
  resetApp();
  vi.useRealTimers();
});

const CHILD = "panel-worktree-helper";
const CHILD_THREAD = "thr_gx4sgexjgw";
const NOW = Date.parse("2026-11-21T18:29:30.000Z");
const text = (element: Element) => element.textContent;

function panel(over: Partial<Handlers> = {}, options: RenderSlotOptions<Contract> = {}) {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  return renderSlot<{ threadId: string }, Contract>({ component: InstancePanel }, { threadId: CHILD_THREAD }, {
    rpc: handlers({ snapshot: () => panelSnapshot(), ...over }),
    sidebarThreads: panelThreads(),
    ...options,
  });
}
async function soulTab(over: Partial<Handlers> = {}) {
  const slot = panel(over);
  await slot.findByTestId("oats-panel");
  act(() => showPanelTab("soul"));
  return slot;
}
const calls = (slot: { inspection: { rpcCalls: { method: string; input: unknown }[] } }, method: string) => slot.inspection.rpcCalls.filter((call) => call.method === method);
const facts = (root: HTMLElement) => within(root).getAllByTestId("oats-fact").map((fact) => `${text(fact.querySelector("dt")!)}: ${text(fact.querySelector("dd")!)}`);

// ---- the Soul tab's body

test("the Soul tab: the soul as this instance was spawned from it, its core capabilities and every other capability with its source and why", async () => {
  const slot = await soulTab();
  const body = await slot.findByTestId("oats-panel-soul-body");
  expect(text(await slot.findByTestId("oats-panel-soul-meta"))).toBe("oats-real");
  expect(text(slot.getByTestId("oats-panel-as-spawned"))).toBe("As spawned: an instance never changes under itself. A newer soul or module needs a new instance.");
  expect(text(slot.getByTestId("oats-panel-spawned-from"))).toBe("Spawned from oats-expert @ 0ab9f62");
  expect(slot.getByTestId("oats-panel-spawned-from").getAttribute("title")).toBe("0ab9f62d3d27913d0fda74c372860b1a90cce147");
  const core = slot.getByTestId("oats-panel-core");
  expect(text(within(core).getByRole("heading"))).toBe("Core capabilities");
  // The recording's workspace fills no core slot.
  expect(facts(core)).toEqual(["Knowledge: None", "Messaging: None", "Tasks: None"]);
  const capabilities = slot.getByTestId("oats-panel-capabilities");
  expect(text(within(capabilities).getByRole("heading"))).toBe("Capabilities2");
  expect(within(capabilities).getAllByTestId("oats-panel-capability").map(text)).toEqual(["oats.bbdefaultoats.bb a3cca8511461e92c25d86f693365ec250b7c4684", "oats.coredefaultoats.framework 1.26.0"]);
  expect(within(capabilities).getAllByText("default")[0]!.getAttribute("title")).toBe("Not declared by this soul: a workspace or team default (the kernel does not say which)");
  expect(text(slot.getByTestId("oats-panel-modules"))).toBe("Modules as spawned · 2");
  expect(within(body).queryByTestId("oats-panel-soul-warnings")).toBeNull();
  // One read of `oats inspect --home`, for this instance.
  expect(calls(slot, "panelSoul").map((call) => call.input)).toEqual([{ instance: CHILD }]);
});

test("a filled core slot names its source and why; a capability the soul turned off is struck; only the core ones says so; warnings with their details", async () => {
  const base = recordedSoul()!;
  const soul: PanelSoul = {
    ...base,
    teams: ["eng"],
    core: [
      { slot: "knowledge", reported: true, id: "oats.okf", source: { kind: "package", name: "oats.okf", version: "2.1.3" }, why: "workspace", team: null },
      { slot: "messaging", reported: true, id: "oats.aweb", source: null, why: "team", team: "eng" },
      { slot: "tasks", reported: false, id: null, source: null, why: null, team: null },
    ],
    capabilities: [{ name: "oats.jira", why: "off", team: null, reason: "off", overrides: "workspace", source: null }],
    warnings: [{ code: "hook-event-unsupported", capability: "oats.core", path: ".oats/modules/oats.core/oats.json", message: "oats.core declares a hook this harness never runs" }],
  };
  const slot = await soulTab({ panelSoul: () => ({ soul }) });
  expect(text(await slot.findByTestId("oats-panel-soul-meta"))).toBe("oats-real · eng");
  expect(facts(slot.getByTestId("oats-panel-core"))).toEqual([
    "Knowledge: oats.okf 2.1.3Resolved the workspace default at spawn", "Messaging: oats.awebResolved the eng team's default at spawn", "Tasks: Not reported",
  ]);
  const off = within(slot.getByTestId("oats-panel-capabilities")).getByTestId("oats-panel-capability");
  expect(text(off)).toBe("oats.jiraturned off by soul");
  expect(off.querySelector(".line-through")).not.toBeNull();
  const warning = within(slot.getByTestId("oats-panel-soul-warnings")).getByTestId("oats-panel-soul-warning");
  expect(text(warning)).toContain("Warningoats.coreoats.core declares a hook this harness never runs");
  expect(facts(within(warning).getByTestId("oats-panel-soul-warning-details"))).toEqual(["Code: hook-event-unsupported", "Path: .oats/modules/oats.core/oats.json"]);
  slot.unmount();
  const coreOnly = await soulTab({ panelSoul: () => ({ soul: { ...base, capabilities: [] } }) });
  expect(text(await coreOnly.findByTestId("oats-panel-capabilities"))).toBe("Capabilities0No other capabilities: only the core ones.");
});

test("an inspection that names no soul draws nothing under the header; a refusal is a notice with the kernel's code, its message under Details, and Retry", async () => {
  const none = await soulTab({ panelSoul: () => ({ soul: null }) });
  await waitFor(() => expect(calls(none, "panelSoul")).toHaveLength(1));
  await waitFor(() => expect(text(none.getByTestId("oats-panel-soul-body"))).toBe(""));
  expect(text(none.getByTestId("oats-panel-soul-name"))).toBe("oats-expert");
  none.unmount();
  let fail = true;
  const slot = await soulTab({
    panelSoul: () => {
      if (fail) throw new Error("E_UNSUPPORTED_MODE: this home has no modules");
      return { soul: recordedSoul() };
    },
  });
  const notice = await within(slot.getByTestId("oats-panel-soul-body")).findByRole("alert");
  expect(text(within(notice).getByRole("heading"))).toBe("The soul as spawned could not be read");
  expect(text(notice)).toContain("E_UNSUPPORTED_MODE");
  expect(text(within(notice).getByTestId("oats-notice-details"))).toContain("this home has no modules");
  fail = false;
  fireEvent.click(within(notice).getByRole("button", { name: "Retry" }));
  expect(text(await slot.findByTestId("oats-panel-spawned-from"))).toContain("Spawned from oats-expert");
});

test("the soul is read again when the instance was started again, and not when nothing of it changed", async () => {
  let startedAt = "2026-11-21T18:13:36.478Z";
  const slot = await soulTab({ panelInstance: ({ instance }) => instanceAnswer(instance, (answer) => ({ ...answer, startedAt })) });
  await slot.findByTestId("oats-panel-spawned-from");
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: "2026-11-21T18:30:00.000Z" }));
  await waitFor(() => expect(calls(slot, "panelInstance").length).toBeGreaterThan(1));
  expect(calls(slot, "panelSoul")).toHaveLength(1);
  startedAt = "2026-11-21T18:31:00.000Z";
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: "2026-11-21T18:31:05.000Z" }));
  await waitFor(() => expect(calls(slot, "panelSoul")).toHaveLength(2));
});

// ---- the recorded activity

test("the activity is read only when a person asks: Load activity, then the rows newest first with their facts, and Refresh activity", async () => {
  const slot = panel();
  const activity = await slot.findByTestId("oats-panel-activity");
  expect(text(within(activity).getByRole("heading"))).toBe("Reported lifecycle activity");
  const load = slot.getByTestId("oats-panel-activity-load");
  expect(text(load)).toBe("Load activity");
  await act(async () => {});
  expect(calls(slot, "panelEvents")).toEqual([]);
  fireEvent.click(load);
  expect(text(await slot.findByTestId("oats-panel-activity-summary"))).toBe(
    "Waiting claim · 2026-11-21T18:23:39.829Z · Current recorded incarnation · Reported waiting: oats.board since 2026-11-21T18:23:39.829Z — Which base branch?",
  );
  expect(text(slot.getByTestId("oats-panel-activity-load"))).toBe("Refresh activity");
  await waitFor(() => expect(text(activity)).toContain("Reported observation loaded. Runtime state is shown separately."));
  const list = slot.getByTestId("oats-panel-activity-list");
  expect(text(list.querySelector("summary")!)).toContain("Recent lifecycle events");
  expect(text(list)).toContain("8 displayed / 8 observed rows. This is address history, not current runtime state.");
  expect(text(within(list).getByTestId("oats-panel-activity-claims"))).toBe("oats.board: reported waiting · 2026-11-21T18:23:39.829Z · attention");
  const rows = within(list).getAllByTestId("oats-panel-event");
  expect(rows.map((row) => text(row.querySelector("strong")!))).toEqual(["Waiting claim", "Launched", "Stopped", "Launched", "Restarted", "Waiting claim", "Launched", "Spawned"]);
  expect(text(rows[7]!.querySelector("time")!)).toBe("2026-11-21T18:13:37.962Z");
  expect(text(rows[7]!)).toContain("Producer: kernel · Current recorded incarnation");
  expect(facts(rows[7]!)).toEqual(["Soul: oats-expert", "Work mode: worktree", "Branch: agents/panel-worktree-helper", "Model: claude-opus-5-5", "Parent: redesign-ui-lead", "Relation: child", "Harness: claude", "Launch reported: true"]);
  expect(facts(rows[2]!)).toEqual(["Signal: not reported", "State reported: stopped", "Waited (ms): 2149", "Targets still running: 0"]);
  expect(text(list)).toContain("no action is authorized by these events.");
  fireEvent.click(slot.getByTestId("oats-panel-activity-load"));
  await waitFor(() => expect(calls(slot, "panelEvents")).toHaveLength(2));
});

test("incomplete evidence is said; an added worktree's setup is listed; a refusal is a notice and what was read stays", async () => {
  const events = recordedEvents();
  let fail = false;
  const slot = panel({
    panelEvents: () => {
      if (fail) throw new Error("E_AMBIGUOUS_INSTANCE: two homes hold an instance of this name");
      return {
        ...events,
        truncated: true,
        integrity: { ...events.integrity, unreadableRows: 1 },
        events: [{ at: "2026-11-21T18:40:00.000Z", kind: "worktree-added", producer: "kernel", incarnation: "earlier" as const, facts: [{ key: "purpose", value: "docs" }], setup: [{ capability: "oats.dev", ok: false, log: "/abs/log" }], policy: null }],
      };
    },
  });
  fireEvent.click(await slot.findByTestId("oats-panel-activity-load"));
  expect(text(await slot.findByTestId("oats-panel-activity-incomplete"))).toBe("Incomplete evidence: 1 unreadable rows · 0 foreign rows · window or source truncated.");
  const row = slot.getByTestId("oats-panel-event");
  expect(text(row)).toContain("Producer: kernel · Earlier instance at this address");
  expect(facts(row)).toEqual(["Purpose: docs", "Setup: oats.dev: failed (continuing)/abs/log"]);
  fail = true;
  fireEvent.click(slot.getByTestId("oats-panel-activity-load"));
  const stale = await within(slot.getByTestId("oats-panel-activity")).findByTestId("oats-stale");
  expect(text(stale)).toContain("It could not be read again (E_AMBIGUOUS_INSTANCE).");
  expect(slot.getByTestId("oats-panel-event")).not.toBeNull();
});

test("a first activity read that fails is a notice with the code and Retry", async () => {
  const slot = panel({
    panelEvents: () => {
      throw new Error("OATS_TIMEOUT: `oats` did not answer within 20 s and was stopped");
    },
  });
  fireEvent.click(await slot.findByTestId("oats-panel-activity-load"));
  const notice = await within(slot.getByTestId("oats-panel-activity")).findByRole("alert");
  expect(text(within(notice).getByRole("heading"))).toBe("The recorded activity could not be read");
  expect(text(notice)).toContain("OATS_TIMEOUT");
  expect(within(notice).getByRole("button", { name: "Retry" })).not.toBeNull();
});

// ---- readiness

test("the instance's readiness: the summary up front, the four checks with their items and the policy behind a fold, and Refresh readiness", async () => {
  const slot = panel();
  const readiness = await slot.findByTestId("oats-panel-readiness-instance");
  expect(text(within(readiness).getByRole("heading"))).toBe("Instance readiness");
  expect(text(await slot.findByTestId("oats-panel-readiness-summary"))).toBe("Ready — every required check passes or is not applicable.");
  expect(calls(slot, "panelReadiness").map((call) => call.input)).toEqual([{ instance: CHILD, of: "instance" }]);
  const checks = slot.getByTestId("oats-panel-readiness-checks");
  expect(text(checks.querySelector("summary")!)).toContain("Checks and policy");
  expect(text(checks)).toContain("Independent kernel observations, not launch permission. Unknown is not granted; an empty required set is not Ready.");
  expect(text(checks)).toMatch(/Observed: 2026-11-21T\d\d:\d\d:\d\d\.\d{3}Z\. This is not an atomic snapshot or a permission lease\./);
  expect(["installed", "configured", "member", "providers"].map((key) => text(slot.getByTestId(`oats-panel-check-${key}`).firstElementChild!))).toEqual(["Installedpass", "Configurednot-applicable", "Memberpass", "Providerspass"]);
  const provider = within(slot.getByTestId("oats-panel-check-providers")).getByTestId("oats-panel-check-item");
  expect(text(provider.querySelector("summary")!)).toContain("oats.bb session backend bb · pass · required · 2 warnings");
  expect(text(provider)).toContain("The provider says: ready.");
  expect(text(provider)).toContain("(session-provider-full-mode-only)");
  const policy = slot.getByTestId("oats-panel-policy");
  expect(text(policy.querySelector("summary")!)).toContain("View policy");
  expect(text(policy)).toContain("Lifecycle authority, not an OS sandbox.");
  expect(text(policy)).toContain("Child spawns: allowed · enforced · default: no spawn option: children allowed");
  const refresh = slot.getByTestId("oats-panel-readiness-refresh");
  expect(text(refresh)).toBe("Refresh readiness");
  fireEvent.click(refresh);
  await waitFor(() => expect(calls(slot, "panelReadiness")).toHaveLength(2));
});

test("failing checks are counted; a check that fails only for a sign-in says so; a problem beyond the reason is a line of its own", async () => {
  const base = recordedReadiness("instance");
  const failing = {
    ...base,
    summary: { ready: false, required: 5, fail: 2, unknown: 0 },
    checks: base.checks.map((check) =>
      check.key !== "providers"
        ? check
        : {
            ...check,
            status: "fail",
            items: [{ subject: "oats.aweb", status: "fail", required: true, producer: "provider binding check", reason: "sign in", code: null, at: null, file: null, evidence: [], remedy: null, provider: { status: "authorization-required", problems: [{ code: "other", message: "the token expired" }], warnings: [] }, problems: [] }],
          },
    ),
    policy: null,
  };
  const slot = panel({ panelReadiness: () => failing });
  expect(text(await slot.findByTestId("oats-panel-readiness-summary"))).toBe("2 failing · 0 unknown · 5 required checks");
  const providers = slot.getByTestId("oats-panel-check-providers");
  expect(text(providers.firstElementChild!)).toBe("Providerssign in needed");
  const item = within(providers).getByTestId("oats-panel-check-item");
  expect(text(item.querySelector("summary")!)).toContain("oats.aweb · sign in needed · required");
  expect(text(item)).toContain("Sign in needed: the provider is set up but is not signed in.");
  expect(text(item)).toContain("the token expired (other)");
  expect(slot.queryByTestId("oats-panel-policy")).toBeNull();
});

test("readiness that cannot be read is a notice with the kernel's code and Retry", async () => {
  let fail = true;
  const slot = panel({
    panelReadiness: () => {
      if (fail) throw new Error("E_HOME_MISMATCH: the home is not this deployment's");
      return recordedReadiness("instance");
    },
  });
  const notice = await within(await slot.findByTestId("oats-panel-readiness-instance")).findByRole("alert");
  expect(text(within(notice).getByRole("heading"))).toBe("Readiness could not be read");
  expect(text(notice)).toContain("E_HOME_MISMATCH");
  fail = false;
  fireEvent.click(within(notice).getByRole("button", { name: "Retry" }));
  expect(text(await slot.findByTestId("oats-panel-readiness-summary"))).toContain("Ready");
});

test("the Soul tab reads the soul's readiness, by the soul; a soul OATS does not name has none to read", async () => {
  const slot = await soulTab();
  const readiness = await slot.findByTestId("oats-panel-readiness-soul");
  expect(text(within(readiness).getByRole("heading"))).toBe("Soul readiness");
  expect(text(await within(readiness).findByTestId("oats-panel-readiness-summary"))).toBe("Ready — every required check passes or is not applicable.");
  expect(calls(slot, "panelReadiness").map((call) => call.input)).toContainEqual({ instance: CHILD, of: "soul" });
  expect(text(within(readiness).getByTestId("oats-panel-policy"))).toContain("Child spawns: allowed · advisory, not enforced · default: no declaration: children allowed");
  slot.unmount();
  const unnamed = await soulTab({ panelInstance: ({ instance }) => ({ ...instanceAnswer(instance), soul: { key: null, description: null } }) });
  await unnamed.findByTestId("oats-panel-open-soul-why");
  expect(unnamed.queryByTestId("oats-panel-readiness-soul")).toBeNull();
});
