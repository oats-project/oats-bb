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
import { whenText } from "../../app/panel/words";
import { waitingClock } from "../../app/ui/words";
import { instanceAnswer, panelAgents, panelSnapshot, panelThreads, recordedEvents, recordedNotReady, recordedReadiness, recordedSoul } from "./handlers";

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
  // each a labelled fact: a bare "oats-real" says nothing of what it is
  expect(facts(await slot.findByTestId("oats-panel-soul-meta"))).toEqual(["Repository: oats-real"]);
  expect(text(slot.getByTestId("oats-panel-as-spawned"))).toBe("As spawned: an instance never changes under itself. A newer soul or module needs a new instance.");
  expect(text(slot.getByTestId("oats-panel-spawned-from"))).toBe("Spawned from oats-expert @ 0ab9f62");
  expect(slot.getByTestId("oats-panel-spawned-from").getAttribute("title")).toBe("0ab9f62d3d27913d0fda74c372860b1a90cce147");
  const core = slot.getByTestId("oats-panel-core");
  expect(text(within(core).getByRole("heading"))).toBe("Core capabilities");
  // The recording's workspace fills no core slot.
  expect(facts(core)).toEqual(["Knowledge: None", "Messaging: None", "Tasks: None"]);
  const capabilities = slot.getByTestId("oats-panel-capabilities");
  expect(text(within(capabilities).getByRole("heading"))).toBe("Capabilities2");
  // each capability: its name, why it is here in words and where it comes from, each under its label (no bare tag);
  // a commit id as a version is short, and whole in the title
  expect(within(capabilities).getAllByTestId("oats-panel-capability").map((row) => [text(row.firstElementChild!), ...facts(row)])).toEqual([
    ["oats.bb", "Here because: Not declared by this soul: a workspace or team default (the kernel does not say which)", "From: oats.bb a3cca85"],
    ["oats.core", "Here because: Not declared by this soul: a workspace or team default (the kernel does not say which)", "From: oats.framework 1.26.0"],
  ]);
  expect(within(capabilities).getAllByTestId("oats-panel-capability")[0]!.querySelector("[title]")!.getAttribute("title")).toBe("package: oats.bb a3cca8511461e92c25d86f693365ec250b7c4684");
  expect(facts(slot.getByTestId("oats-panel-modules"))).toEqual(["Modules as spawned: 2"]);
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
  expect(facts(await slot.findByTestId("oats-panel-soul-meta"))).toEqual(["Repository: oats-real", "Team: eng"]);
  expect(facts(slot.getByTestId("oats-panel-core"))).toEqual([
    "Knowledge: oats.okf 2.1.3Resolved the workspace default at spawn", "Messaging: oats.awebResolved the eng team's default at spawn", "Tasks: Not reported",
  ]);
  // One the soul turned off is listed and not counted.
  expect(text(slot.getByTestId("oats-panel-capabilities").querySelector("h3, h2, h4")!)).toMatch(/^Capabilities\s*0$/);
  const off = within(slot.getByTestId("oats-panel-capabilities")).getByTestId("oats-panel-capability");
  expect(text(off.firstElementChild!)).toBe("oats.jira");
  expect(facts(off)).toEqual(["Not here: This soul turns off the workspace default"]);
  expect(off.querySelector(".line-through")).not.toBeNull();
  const warning = within(slot.getByTestId("oats-panel-soul-warnings")).getByTestId("oats-panel-warning");
  expect(text(warning)).toContain("Warningoats.coreoats.core declares a hook this harness never runs");
  expect(facts(within(warning).getByTestId("oats-panel-warning-details"))).toEqual(["Code: hook-event-unsupported", "Path: .oats/modules/oats.core/oats.json"]);
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
      if (fail) throw new Error("OATS_FAILED: `oats` exited 1: boom");
      return { soul: recordedSoul() };
    },
  });
  const notice = await within(slot.getByTestId("oats-panel-soul-body")).findByRole("alert");
  expect(text(within(notice).getByRole("heading"))).toBe("The soul as spawned could not be read");
  expect(text(notice)).toContain("OATS could not finish reading it.");
  expect(text(notice)).toContain("OATS_FAILED");
  expect(text(within(notice).getByTestId("oats-notice-details"))).toContain("exited 1: boom");
  fail = false;
  fireEvent.click(within(notice).getByRole("button", { name: "Retry" }));
  expect(text(await slot.findByTestId("oats-panel-spawned-from"))).toContain("Spawned from oats-expert");
  slot.unmount();
  resetApp();
  // A refusal that reading again cannot change says what happened and what to do, and offers no Retry.
  const final = await soulTab({
    panelSoul: () => {
      throw new Error("E_HOME_MISMATCH: the home is not this deployment's");
    },
  });
  const refused = await within(final.getByTestId("oats-panel-soul-body")).findByRole("alert");
  expect(text(refused)).toContain("This agent's folder is no longer the one OATS recorded for it.oats status, on the machine that holds it, shows where the agent is now.");
  expect(text(refused)).toContain("E_HOME_MISMATCH");
  expect(within(refused).queryByRole("button", { name: "Retry" })).toBeNull();
  // The way to read again, for whoever mended it, is the part's own button, as in readiness and the activity.
  expect(text(final.getByTestId("oats-panel-soul-again"))).toBe("Read the soul again");
  final.unmount();
  resetApp();
  // OATS has none of it for this kind of agent: a fact, not a failure. Said once, not in red, with nothing to press.
  const noRecord = await soulTab({
    panelSoul: () => {
      throw new Error("E_UNSUPPORTED_MODE: this home has no modules");
    },
  });
  const fact = await within(noRecord.getByTestId("oats-panel-soul-body")).findByTestId("oats-notice");
  expect([fact.getAttribute("data-tone"), fact.getAttribute("role")]).toEqual(["info", "status"]);
  expect(text(within(fact).getByRole("heading"))).toBe("OATS keeps no record of what this kind of agent was spawned from");
  expect(text(fact)).toContain("E_UNSUPPORTED_MODE");
  expect(within(fact).queryByRole("button", { name: "Retry" })).toBeNull();
  expect(noRecord.queryByTestId("oats-panel-soul-again")).toBeNull();
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
  // The last recorded event, its instant in the plugin's one form. What the agent waits for is the header's and
  // Needs input's to say, from the roster as it is now: the summary says nothing of it.
  expect(text(await slot.findByTestId("oats-panel-activity-summary"))).toBe(`Last recorded: Waiting claim · ${whenText("2026-11-21T18:23:39.829Z", NOW)}`);
  expect(text(slot.getByTestId("oats-panel-activity-load"))).toBe("Refresh activity");
  await waitFor(() => expect(text(activity)).toContain("Reported observation loaded. Runtime state is shown separately."));
  const list = slot.getByTestId("oats-panel-activity-list");
  expect(text(list.querySelector("summary")!)).toContain("Recent lifecycle events");
  // a person's words first, then the kernel's own sentence
  expect(text(within(list).getByTestId("oats-panel-activity-plain"))).toBe("What OATS recorded about this agent, newest first. It is history, not what the agent does now.");
  expect(text(list)).toContain("8 displayed / 8 observed rows. This is address history, not current runtime state.");
  // Nothing in the list reads as what the agent waits for now: the claims are its "Waiting claim" rows, each at its own time.
  expect(within(list).queryByTestId("oats-panel-activity-claims")).toBeNull();
  expect(text(list)).not.toContain("reported waiting");
  const rows = within(list).getAllByTestId("oats-panel-event");
  expect(rows.map((row) => text(row.querySelector("strong")!))).toEqual(["Waiting claim", "Launched", "Stopped", "Launched", "Restarted", "Waiting claim", "Launched", "Spawned"]);
  // the plugin's one form for an instant; the kernel's own text of it is the title
  expect([text(rows[7]!.querySelector("time")!), rows[7]!.querySelector("time")!.getAttribute("title"), rows[7]!.querySelector("time")!.getAttribute("datetime")]).toEqual([whenText("2026-11-21T18:13:37.962Z", NOW), "2026-11-21T18:13:37.962Z", "2026-11-21T18:13:37.962Z"]);
  expect(text(rows[7]!)).toContain("Producer: kernel · Current recorded incarnation");
  expect(facts(rows[7]!)).toEqual(["Soul: oats-expert", "Work mode: worktree", "Branch: agents/panel-worktree-helper", "Model: claude-opus-5-5", "Parent: redesign-ui-lead", "Relation: child", "Harness: claude", "Launch reported: true"]);
  expect(facts(rows[2]!)).toEqual(["Signal: not reported", "State reported: stopped", "Waited (ms): 2149", "Targets still running: 0"]);
  expect(text(list)).toContain("Reading this starts nothing and allows nothing.");
  expect(text(list)).not.toContain("Null waiting");
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
        events: [{ at: "2026-11-21T18:40:00.000Z", kind: "worktree-added", producer: "kernel", incarnation: "earlier" as const, facts: [{ key: "purpose", value: "docs" }], setup: [{ capability: "oats.dev", ok: false, log: "/abs/log" }], policy: null, differed: null }],
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
  // What was read stays under the titled notice: what happened, what to do, the code; no Retry that cannot help, so Refresh stays.
  const stale = await within(slot.getByTestId("oats-panel-activity")).findByRole("alert");
  expect(text(within(stale).getByRole("heading"))).toBe("The recorded activity could not be read again");
  expect(text(stale)).toContain("OATS knows more than one agent by this name here, so it cannot say which one this is.Retire or rename one of them with OATS, on the machine that holds them.");
  expect(text(stale)).toContain("Showing what was read less than a minute ago.");
  expect(text(stale)).toContain("E_AMBIGUOUS_INSTANCE");
  expect(within(stale).queryByRole("button", { name: "Retry" })).toBeNull();
  expect(text(slot.getByTestId("oats-panel-activity-load"))).toBe("Refresh activity");
  expect(slot.getByTestId("oats-panel-event")).not.toBeNull();
});

test("the activity read earlier is shown again as the last observation after the tab was left and come back to, with Refresh activity", async () => {
  const slot = panel();
  fireEvent.click(await slot.findByTestId("oats-panel-activity-load"));
  await slot.findByTestId("oats-panel-activity-summary");
  await waitFor(() => expect(text(slot.getByTestId("oats-panel-activity-status"))).toBe("Reported observation loaded. Runtime state is shown separately."));
  act(() => showPanelTab("soul"));
  await slot.findByTestId("oats-panel-soul-body");
  act(() => showPanelTab("instance"));
  expect(text(await slot.findByTestId("oats-panel-activity-load"))).toBe("Refresh activity");
  expect(text(await slot.findByTestId("oats-panel-activity-summary"))).toContain(`Last recorded: Waiting claim · ${whenText("2026-11-21T18:23:39.829Z", NOW)}`);
  await waitFor(() => expect(text(slot.getByTestId("oats-panel-activity-status"))).toBe("Last observation retained; refresh required."));
  expect(calls(slot, "panelEvents")).toHaveLength(1);
  fireEvent.click(slot.getByTestId("oats-panel-activity-load"));
  await waitFor(() => expect(calls(slot, "panelEvents")).toHaveLength(2));
  await waitFor(() => expect(text(slot.getByTestId("oats-panel-activity-status"))).toBe("Reported observation loaded. Runtime state is shown separately."));
});

test("a blocked launch's row shows what its screen differed in, the terminal's text as a quote under whose text it is; an empty window says so", async () => {
  const events = recordedEvents();
  const slot = panel({
    panelEvents: () => ({
      ...events,
      events: [{ at: "2026-11-21T18:40:00.000Z", kind: "launch-prompt", producer: "kernel", incarnation: "current" as const, facts: [{ key: "status", value: "blocked" }], setup: null, policy: null, differed: { nearest: "dev-channel-1", index: 12, expected: "Do you trust this folder?", found: "Yes, proceed\u202E" } }],
    }),
  });
  fireEvent.click(await slot.findByTestId("oats-panel-activity-load"));
  const differed = await slot.findByTestId("oats-panel-event-differed");
  expect(text(differed)).toBe("Where the screen first differed from the confirmation OATS answers:OATS expected:Do you trust this folder?The terminal showed:Yes, proceed\uFFFDNearest entry dev-channel-1, first difference at 12");
  slot.unmount();
  const empty = panel({ panelEvents: () => ({ ...events, count: 0, returned: 0, events: [], waitingOnYou: null, waitingClaims: [] }) });
  fireEvent.click(await empty.findByTestId("oats-panel-activity-load"));
  // never "Waiting on you: unknown" under a header that says what the agent waits for; and said once, not again inside the fold
  expect(text(await empty.findByTestId("oats-panel-activity-summary"))).toBe("No recorded lifecycle events in this observed window.");
  expect(text(empty.getByTestId("oats-panel-activity-list"))).not.toContain("No recorded lifecycle events");
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
  // The Desktop's own sentence for it, then the code; the kernel's message one press away.
  expect(text(notice)).toContain("The activity read timed out.");
  expect(text(notice)).toContain("OATS_TIMEOUT");
  expect(text(within(notice).getByTestId("oats-notice-details"))).toContain("did not answer within 20 s");
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
  expect(text(within(checks).getByTestId("oats-panel-readiness-plain"))).toBe("What OATS checked for this to run. Reading it starts nothing and allows nothing.");
  expect(text(checks)).toContain(`Observed: ${whenText(recordedReadiness("instance").at!, NOW)}. Target: instance. This is not an atomic snapshot or a permission lease.`);
  // what was observed, over the checks: the instance and the agents root the roster names
  expect(text(within(checks).getByTestId("oats-panel-readiness-context"))).toMatch(new RegExp(`^Instance: ${CHILD} · /.+/agents$`));
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
  expect(slot.queryByTestId("oats-panel-readiness-status")).toBeNull();
  fireEvent.click(refresh);
  await waitFor(() => expect(calls(slot, "panelReadiness")).toHaveLength(2));
  // A person's Refresh says that it read again.
  await waitFor(() => expect(text(slot.getByTestId("oats-panel-readiness-status"))).toBe("Readiness updated"));
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
  // the kernel's command in the sentence is drawn as code, not between backticks
  expect(text(notice)).toContain("This agent's folder is no longer the one OATS recorded for it.oats status, on the machine that holds it, shows where the agent is now.");
  expect(within(notice).getByText("oats status").tagName).toBe("CODE");
  expect(text(notice)).toContain("E_HOME_MISMATCH");
  // Reading again cannot change it: no Retry in the notice; Refresh readiness is the section's own.
  expect(within(notice).queryByRole("button", { name: "Retry" })).toBeNull();
  fail = false;
  fireEvent.click(slot.getByTestId("oats-panel-readiness-refresh"));
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

test("readiness read again that fails keeps what was read, with its age, the Desktop's sentence and the code", async () => {
  let fail = false;
  const slot = panel({
    panelReadiness: () => {
      if (fail) throw new Error("OATS_TIMEOUT: `oats` did not answer within 20 s and was stopped");
      return { ...recordedReadiness("instance"), at: "2026-11-21T18:26:30.000Z" };
    },
  });
  await slot.findByTestId("oats-panel-readiness-summary");
  fail = true;
  fireEvent.click(slot.getByTestId("oats-panel-readiness-refresh"));
  const stale = await within(slot.getByTestId("oats-panel-readiness-instance")).findByRole("alert");
  expect(text(within(stale).getByRole("heading"))).toBe("Readiness could not be read again");
  // the age of what is still shown, relative, from the instant the kernel's answer names
  expect(text(stale)).toContain("Showing what was read 3 min ago.");
  expect(text(stale)).toContain("The readiness read timed out.");
  expect(text(stale)).toContain("OATS_TIMEOUT");
  expect(slot.getByTestId("oats-panel-readiness-summary")).not.toBeNull();
  expect(slot.queryByTestId("oats-panel-readiness-status")).toBeNull();
});

test("readiness' capability warnings are drawn as the Soul tab draws them", async () => {
  const slot = panel({ panelReadiness: () => ({ ...recordedReadiness("instance"), warnings: [{ code: "hook-event-unsupported", capability: "vault.api-key", path: "oats.json", message: "one declared hook never runs here" }] }) });
  await slot.findByTestId("oats-panel-readiness-summary");
  const warning = within(slot.getByTestId("oats-panel-readiness-warnings-instance")).getByTestId("oats-panel-warning");
  expect(text(warning)).toContain("Warningvault.api-keyone declared hook never runs here");
  expect(facts(within(warning).getByTestId("oats-panel-warning-details"))).toEqual(["Code: hook-event-unsupported", "Path: oats.json"]);
});

test("the recorded readiness that is not ready: the summary's counts, the failing check and its item with the provider's own answer", async () => {
  const slot = panel({ panelReadiness: () => recordedNotReady() });
  expect(text(await slot.findByTestId("oats-panel-readiness-summary"))).toBe("1 failing · 0 unknown · 4 required checks");
  const providers = within(slot.getByTestId("oats-panel-readiness-instance")).getByTestId("oats-panel-check-providers");
  expect(text(providers)).toContain("Providersfail");
  const item = within(providers).getByTestId("oats-panel-check-item");
  expect(text(item)).toContain("oats.bb session backend bb · fail · required · 2 warnings");
  expect(facts(item)).toEqual([
    "Producer: session provider check",
    "Reason: the bb version could not be read (cannot run bb: spawn bb ENOENT: install bb-app or set settings.oats.bb.cli)",
    "Problem code: E_BACKEND_VERSION",
  ]);
  expect(text(item)).toContain("The provider says: needs configuration.");
});

test("a tab turned back to shows what was read: readiness and the soul are not read again until asked or until the instance changed", async () => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const slot = panel();
  await slot.findByTestId("oats-panel-readiness-summary");
  act(() => showPanelTab("soul"));
  await within(await slot.findByTestId("oats-panel-readiness-soul")).findByTestId("oats-panel-readiness-summary");
  await slot.findByTestId("oats-panel-spawned-from");
  // Long after bb's query client calls an answer stale.
  vi.setSystemTime(NOW + 10 * 60_000);
  act(() => showPanelTab("instance"));
  await slot.findByTestId("oats-panel-readiness-summary");
  act(() => showPanelTab("soul"));
  await slot.findByTestId("oats-panel-spawned-from");
  await act(async () => { await new Promise((done) => setTimeout(done, 50)); });
  expect(calls(slot, "panelReadiness").map((call) => (call.input as { of: string }).of)).toEqual(["instance", "soul"]);
  expect(calls(slot, "panelSoul")).toHaveLength(1);
  // Refresh readiness still reads.
  fireEvent.click(within(slot.getByTestId("oats-panel-readiness-soul")).getByTestId("oats-panel-readiness-refresh"));
  await waitFor(() => expect(calls(slot, "panelReadiness").map((call) => (call.input as { of: string }).of)).toEqual(["instance", "soul", "soul"]));
});

test("a readiness note of the kernel's goes through the display filter", async () => {
  const slot = panel({ panelReadiness: () => ({ ...recordedReadiness("instance"), notes: ["note \u202Egnp.exe", "token: abc123"] }) });
  await slot.findByTestId("oats-panel-readiness-summary");
  const checks = text(slot.getByTestId("oats-panel-readiness-checks"));
  expect(checks).toContain("note \uFFFDgnp.exe");
  expect(checks).not.toContain("\u202E");
  expect(checks).not.toContain("abc123");
});

test("Refresh activity over what is shown says that it reads, until the kernel answers", async () => {
  let answer: (() => void) | null = null;
  let reads = 0;
  const slot = panel({
    panelEvents: () => {
      reads += 1;
      if (reads === 1) return recordedEvents();
      return new Promise((done) => {
        answer = () => done(recordedEvents());
      });
    },
  });
  fireEvent.click(await slot.findByTestId("oats-panel-activity-load"));
  await waitFor(() => expect(text(slot.getByTestId("oats-panel-activity-status"))).toBe("Reported observation loaded. Runtime state is shown separately."));
  fireEvent.click(slot.getByTestId("oats-panel-activity-load"));
  await waitFor(() => expect(text(slot.getByTestId("oats-panel-activity-status"))).toBe("Reading the recorded activity…"));
  expect((slot.getByTestId("oats-panel-activity-load") as HTMLButtonElement).disabled).toBe(true);
  expect(slot.getByTestId("oats-panel-activity-summary")).not.toBeNull();
  act(() => answer?.());
  await waitFor(() => expect(text(slot.getByTestId("oats-panel-activity-status"))).toBe("Reported observation loaded. Runtime state is shown separately."));
});

test("a Refresh activity still running when its tab is come back to says that it reads, and cannot be pressed again; one after a failed refresh says it once", async () => {
  let answer: (() => void) | null = null;
  let mode: "ok" | "pending" | "fail" = "ok";
  const slot = panel({
    panelEvents: () => {
      if (mode === "fail") throw new Error("OATS_FAILED: `oats` exited 1: boom");
      if (mode === "ok") return recordedEvents();
      return new Promise((done) => {
        answer = () => done(recordedEvents());
      });
    },
  });
  fireEvent.click(await slot.findByTestId("oats-panel-activity-load"));
  await slot.findByTestId("oats-panel-activity-summary");
  mode = "pending";
  fireEvent.click(slot.getByTestId("oats-panel-activity-load"));
  await waitFor(() => expect(text(slot.getByTestId("oats-panel-activity-status"))).toBe("Reading the recorded activity…"));
  act(() => showPanelTab("soul"));
  await slot.findByTestId("oats-panel-soul-body");
  act(() => showPanelTab("instance"));
  // the read asked for before the tab was left still runs
  expect(text(await slot.findByTestId("oats-panel-activity-status"))).toBe("Reading the recorded activity…");
  expect((slot.getByTestId("oats-panel-activity-load") as HTMLButtonElement).disabled).toBe(true);
  act(() => answer?.());
  await waitFor(() => expect((slot.getByTestId("oats-panel-activity-load") as HTMLButtonElement).disabled).toBe(false));
  // a refresh that fails, then one more while the first failure is still shown: said once, by the line that holds the failure
  mode = "fail";
  fireEvent.click(slot.getByTestId("oats-panel-activity-load"));
  const stale = await within(slot.getByTestId("oats-panel-activity")).findByRole("alert");
  // After a failure that reading again can change, the notice's Retry is the one act: no second button under it for the same read.
  expect(slot.queryByTestId("oats-panel-activity-load")).toBeNull();
  mode = "pending";
  fireEvent.click(within(stale).getByRole("button", { name: "Retry" }));
  // the read again is said once, by the button that started it
  await waitFor(() => expect(text(within(slot.getByTestId("oats-panel-activity")).getByRole("alert"))).toContain("Reading…"));
  expect(slot.queryByTestId("oats-panel-activity-status")).toBeNull();
  expect(within(slot.getByTestId("oats-panel-activity")).queryAllByRole("status")).toHaveLength(0);
  act(() => answer?.());
});

// ---- from the second UX read

test("a failing check stands out, an item with nothing more to say is a line and not a fold, and a sign-in says what to do", async () => {
  const notReady = recordedNotReady();
  const slot = panel({
    panelReadiness: () => ({
      ...notReady,
      checks: notReady.checks.map((check) =>
        check.key === "installed" ? { ...check, items: [{ ...check.items[0]!, evidence: [], reason: null, code: null, at: null, file: null, remedy: null, producer: null }] } : check,
      ),
    }),
  });
  const summary = await slot.findByTestId("oats-panel-readiness-summary");
  // marked, not only bold: a mark and its words
  expect(summary.querySelector('[data-testid="oats-toned"]')?.getAttribute("data-tone")).toBe("bad");
  const providers = slot.getByTestId("oats-panel-check-providers");
  expect(within(providers).getByTestId("oats-panel-check-state").querySelector('[data-testid="oats-toned"]')?.getAttribute("data-tone")).toBe("bad");
  // a check that passes is said plainly
  expect(within(slot.getByTestId("oats-panel-check-member")).getByTestId("oats-panel-check-state").querySelector('[data-testid="oats-toned"]')).toBeNull();
  // nothing under it: a line, no fold to open on nothing
  const bare = within(slot.getByTestId("oats-panel-check-installed")).getAllByTestId("oats-panel-check-item")[0]!;
  expect([bare.tagName, text(bare)]).toEqual(["P", "oats.bb · pass · required"]);
  slot.unmount();
  resetApp();
  const base = recordedReadiness("instance");
  const signIn = panel({
    panelReadiness: () => ({
      ...base,
      summary: { ...base.summary, ready: false, fail: 1 },
      checks: base.checks.map((check) =>
        check.key === "providers" ? { ...check, status: "fail", items: check.items.map((item) => ({ ...item, status: "fail", provider: { status: "authorization-required", problems: [], warnings: [] } })) } : check,
      ),
    }),
  });
  const waits = await within(await signIn.findByTestId("oats-panel-readiness-instance")).findByTestId("oats-panel-check-providers");
  expect(within(waits).getByTestId("oats-panel-check-state").querySelector('[data-testid="oats-toned"]')?.getAttribute("data-tone")).toBe("warn");
  expect(text(waits)).toContain("Sign in needed: the provider is set up but is not signed in.Sign in to it on this computer, then press Refresh readiness.");
});

test("one act at a time: no Refresh while the first read runs, and none beside a failure's Retry", async () => {
  let release: (() => void) | null = null;
  let fail = false;
  const slot = panel({
    panelReadiness: () => {
      if (fail) throw new Error("OATS_TIMEOUT: `oats` did not answer within 20 s and was stopped");
      return new Promise((done) => (release = () => done(recordedReadiness("instance"))));
    },
  });
  const section = await slot.findByTestId("oats-panel-readiness-instance");
  // the first read runs: the line says so, and there is no button that could not be pressed
  expect(text(within(section).getByTestId("oats-loading"))).toBe("Reading readiness…");
  expect(within(section).queryByTestId("oats-panel-readiness-refresh")).toBeNull();
  await waitFor(() => expect(release).not.toBeNull());
  act(() => release?.());
  const refresh = await within(section).findByTestId("oats-panel-readiness-refresh");
  fail = true;
  fireEvent.click(refresh);
  const stale = await within(section).findByRole("alert");
  expect(within(stale).getByRole("button", { name: "Retry" })).not.toBeNull();
  expect(within(section).queryByTestId("oats-panel-readiness-refresh")).toBeNull();
});

test("the roster and the activity are read at two moments: an activity that names a newer claim than the roster's asks for the roster again, once, and the header then says the newer claim", async () => {
  // The roster was read at 18:16 (the agent waits since 18:14 for its first question). Since then the agent was
  // started again and asked something new: the activity, read now, names a claim since 18:23.
  let refreshed = 0;
  const older = panelAgents();
  const newer = older.map((agent) => (agent.instance === CHILD ? { ...agent, waiting: { reason: "attention", message: "Which base branch?", since: "2026-11-21T18:23:39.829Z" } } : agent));
  const slot = panel({
    snapshot: () => panelSnapshot(refreshed === 0 ? older : newer),
    refresh: () => {
      refreshed += 1;
      return { at: "2026-11-21T18:29:31.000Z" };
    },
  });
  await slot.findByTestId("oats-panel-waiting");
  expect(text(slot.getByTestId("oats-panel-waiting-message"))).toBe("How should I merge the pull request?");
  expect(recordedEvents().waitingOnYou?.since).toBe("2026-11-21T18:23:39.829Z");
  expect(refreshed).toBe(0);
  fireEvent.click(slot.getByTestId("oats-panel-activity-load"));
  await slot.findByTestId("oats-panel-activity-summary");
  // the header would otherwise keep the older question until the roster's next read
  await waitFor(() => expect(refreshed).toBe(1));
  // what the person then sees: the header and Needs input say the claim the activity names
  await waitFor(() => expect(text(slot.getByTestId("oats-panel-waiting-message"))).toBe("Which base branch?"));
  expect(text(slot.getByTestId("oats-panel-state"))).toContain(`since ${waitingClock("2026-11-21T18:23:39.829Z", NOW)}`);
  // the same answer drawn again asks nothing more
  act(() => showPanelTab("soul"));
  act(() => showPanelTab("instance"));
  await slot.findByTestId("oats-panel-activity-summary");
  expect(refreshed).toBe(1);
});

test("an activity whose standing claim is the roster's asks for nothing", async () => {
  let refreshed = 0;
  const events = recordedEvents();
  const slot = panel({
    refresh: () => {
      refreshed += 1;
      return { at: "2026-11-21T18:29:31.000Z" };
    },
    // the claim the recorded roster holds for the agent: since 18:14:12.916Z
    panelEvents: () => ({ ...events, waitingOnYou: { producer: "oats.board", since: "2026-11-21T18:14:12.916Z", message: "How should I merge the pull request?" } }),
  });
  fireEvent.click(await slot.findByTestId("oats-panel-activity-load"));
  await slot.findByTestId("oats-panel-activity-summary");
  await act(async () => { await new Promise((done) => setTimeout(done, 50)); });
  expect(refreshed).toBe(0);
});

test("readiness says what was observed with its path whole between segments, and a commit id short with the whole value as its title", async () => {
  const slot = panel();
  await slot.findByTestId("oats-panel-readiness-summary");
  const context = slot.getByTestId("oats-panel-readiness-context");
  expect(text(context)).toBe(`Instance: ${CHILD} · /abs/deployment/agents`);
  // a line may end after a slash, never inside a name
  expect(context.querySelectorAll("wbr")).toHaveLength(3);
  expect(context.className).not.toContain("break-all");
  const origin = within(slot.getByTestId("oats-panel-check-installed")).getAllByTestId("oats-fact").find((fact) => text(fact.querySelector("dt")!) === "Origin")!;
  // the id beside its own short form is said once
  expect(text(origin.querySelector("dd")!)).toBe("package oats.bb a3cca85");
  expect(origin.querySelector("dd")!.getAttribute("title")).toBe("package oats.bb a3cca8511461e92c25d86f693365ec250b7c4684 @ a3cca85");
});
