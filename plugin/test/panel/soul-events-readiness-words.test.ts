// The words of the Soul tab's body, of the recorded activity and of readiness: the OATS Desktop's,
// for the answers recorded from the real kernel.
import { describe, expect, it } from "vitest";
import { claimLine, differedLines, eventFacts, eventTitle, incomplete, incompleteLine, producerLine, setupLine, sourcesLine, summaryLine as activitySummary, windowLine } from "../../app/panel/events-words";
import { refusalSentence } from "../../app/panel/refusal-words";
import { checkLabel, checkState, declaredIn, itemFacts, itemLine, itemProblems, observedLine, policyLine, providerSays, summaryLine, warningLine } from "../../app/panel/readiness-words";
import { coreNote, emptySlot, layerLabel, modulesAsSpawned, soulMeta, sourceKind, sourceText, spawnedFrom, whyTag } from "../../app/panel/soul-words";
import type { PanelCapability } from "../../kernel/panel-soul";
import type { PanelReadinessItem } from "../../kernel/panel-readiness";
import { recordedEvents, recordedReadiness } from "./handlers";

describe("the Soul tab's words", () => {
  it("a core slot: its name, what fills it or that nothing does, and why in an instance's words", () => {
    expect((["knowledge", "messaging", "tasks"] as const).map(layerLabel)).toEqual(["Knowledge", "Messaging", "Tasks"]);
    const slot = { slot: "knowledge" as const, id: null, source: null, why: null, team: null };
    expect([emptySlot({ ...slot, reported: true }), emptySlot({ ...slot, reported: false })]).toEqual(["None", "Not reported"]);
    expect(coreNote({ why: "workspace", team: null })).toBe("Resolved the workspace default at spawn");
    expect(coreNote({ why: "team", team: "eng" })).toBe("Resolved the eng team's default at spawn");
    expect(coreNote({ why: "soul", team: null })).toBe("Chosen by the soul at spawn");
    expect(coreNote({ why: null, team: null })).toBeNull();
  });
  it("a source, and why a capability is there", () => {
    expect(sourceText({ kind: "package", name: "oats.framework", version: "1.26.0" })).toBe("oats.framework 1.26.0");
    expect(sourceText({ kind: "repo", name: "agents", version: null })).toBe("agents");
    expect((["package", "repo", "home"] as const).map((kind) => sourceKind({ kind, name: "x", version: null }))).toEqual(["package", "repository", "the soul's own repository"]);
    const capability = (over: Partial<PanelCapability>): PanelCapability => ({ name: "oats.jira", why: "default", team: null, reason: null, overrides: null, source: null, ...over });
    expect(whyTag(capability({}))).toEqual({ label: "default", title: "Not declared by this soul: a workspace or team default (the kernel does not say which)" });
    expect(whyTag(capability({ why: "workspace" }))).toEqual({ label: "workspace", title: "A workspace default" });
    expect(whyTag(capability({ why: "soul" }))).toEqual({ label: "soul", title: "Declared by this soul" });
    expect(whyTag(capability({ why: "team", team: "eng" }))).toEqual({ label: "team · eng", title: "A default of the eng team" });
    expect(whyTag(capability({ why: "off", reason: "off", overrides: "workspace" }))).toEqual({ label: "turned off by soul", title: "This soul turns off the workspace default" });
    expect(whyTag(capability({ why: "off", reason: "slot-none", overrides: "team:eng" }))).toEqual({ label: "turned off by soul", title: "This soul empties a core slot, which the eng team's default filled with oats.jira" });
    expect(whyTag(capability({ why: "off", reason: "off", overrides: null })).title).toBe("This soul turns off a default");
  });
  it("where it was spawned from, its modules and its line of repository and teams", () => {
    expect(spawnedFrom({ name: "oats-expert", commit: "0ab9f62d3d27913d0fda74c372860b1a90cce147" })).toBe("Spawned from oats-expert @ 0ab9f62");
    expect(spawnedFrom({ name: "oats-expert", commit: null })).toBe("Spawned from oats-expert");
    expect(modulesAsSpawned(2)).toBe("Modules as spawned · 2");
    expect(soulMeta({ repo: "oats-real", teams: ["eng", "ops"] })).toBe("oats-real · eng, ops");
    expect(soulMeta({ repo: null, teams: [] })).toBeNull();
  });
});

describe("the recorded activity's words", () => {
  const events = recordedEvents();
  it("a title per kind, the Desktop's; a kind with none is named as the kernel names it", () => {
    expect(["spawned", "launched", "restarted", "stopped", "stop-refused", "retire-planned", "retired", "worktree-retained", "worktree-removed", "branch-deleted", "child-spawn-refused", "launch-prompt", "recomposed", "waiting", "worktree-added", "modules-upgraded", "upgrade-refused"].map(eventTitle)).toEqual([
      "Spawned", "Launched", "Restarted", "Stopped", "Stop refused", "Retirement planned", "Retired", "Worktree retained", "Worktree removed", "Branch deleted", "Child spawn refused", "Launch prompt",
      "Instructions recomposed", "Waiting claim", "Worktree added", "Modules upgraded", "Module upgrade refused",
    ]);
    expect(eventTitle("retire-warning")).toBe("Other reported event (retire-warning)");
    expect(eventTitle("constructor")).toBe("Other reported event (constructor)");
  });
  it("the recorded rows' facts, labelled; a claim set or cleared in words; what was not reported", () => {
    expect(eventFacts(events.events[0]!)).toEqual([
      { label: "Soul", value: "oats-expert" }, { label: "Work mode", value: "worktree" }, { label: "Branch", value: "agents/panel-worktree-helper" }, { label: "Model", value: "claude-opus-5-5" },
      { label: "Parent", value: "redesign-ui-lead" }, { label: "Relation", value: "child" }, { label: "Harness", value: "claude" }, { label: "Launch reported", value: "true" },
    ]);
    expect(eventFacts(events.events[1]!)).toEqual([{ label: "Backend", value: "bb" }, { label: "Launch configuration", value: "not reported" }, { label: "Harness", value: "claude" }]);
    expect(eventFacts(events.events[2]!)).toEqual([{ label: "Waiting claim", value: "claimed" }, { label: "Reported reason", value: "attention" }, { label: "Note", value: "How should I merge the pull request?" }]);
    expect(eventFacts(events.events[5]!)).toEqual([{ label: "Signal", value: "not reported" }, { label: "State reported", value: "stopped" }, { label: "Waited (ms)", value: "2149" }, { label: "Targets still running", value: "0" }]);
    const refused = { at: "", kind: "child-spawn-refused", producer: "kernel", incarnation: "current" as const, facts: [{ key: "child", value: "dev-b" }, { key: "unknown", value: "x" }, { key: "waitingOnYou", value: false }], setup: null, policy: { allowed: false, origin: "soul" }, differed: null };
    expect(eventFacts(refused)).toEqual([{ label: "Child", value: "dev-b" }, { label: "Waiting claim", value: "cleared" }, { label: "Reported child policy", value: "not allowed · soul" }]);
    expect([setupLine({ capability: "oats.dev", ok: true }), setupLine({ capability: "oats.x", ok: false })]).toEqual(["oats.dev: done", "oats.x: failed (continuing)"]);
  });
  it("who produced a row and for which incarnation; the window, its sources and its claims", () => {
    expect(producerLine(events.events[0]!)).toBe("Producer: kernel · Current recorded incarnation");
    expect(producerLine({ producer: "oats.board", incarnation: "earlier" })).toBe("Producer: oats.board · Earlier instance at this address");
    expect(producerLine({ producer: "kernel", incarnation: "unknown" })).toBe("Producer: kernel · Incarnation not reported");
    expect(windowLine(events)).toBe("8 displayed / 8 observed rows. This is address history, not current runtime state.");
    expect(windowLine({ returned: 100, count: 250, truncated: true })).toBe("100 displayed / 250 observed rows · truncated. This is address history, not current runtime state.");
    expect(sourcesLine(events)).toMatch(/^home: ok \(\d+ bytes reported\) · workspace: ok \(\d+ bytes reported\)$/);
    expect(claimLine(events.waitingClaims[0]!)).toBe("oats.board: reported waiting · 2026-11-21T18:23:39.829Z · attention");
    expect(claimLine({ producer: "oats.core", waiting: false, since: "2026-11-21T18:30:00.000Z", reason: null })).toBe("oats.core: claim cleared · 2026-11-21T18:30:00.000Z");
    expect(activitySummary(events)).toBe("Waiting claim · 2026-11-21T18:23:39.829Z · Current recorded incarnation · Reported waiting: oats.board since 2026-11-21T18:23:39.829Z — Which base branch?");
    expect(activitySummary({ ...events, events: [], waitingOnYou: null })).toBe("No recorded lifecycle events in this observed window. · Waiting on you: unknown");
  });
  it("says when the evidence is not whole", () => {
    expect(incomplete(events)).toBe(false);
    const cut = { truncated: true, integrity: { unreadableRows: 1, foreignRows: 2, sources: [{ path: "home", status: "refused", bytes: 0 }, { path: "workspace", status: "tail", bytes: 5_000_000 }] } };
    expect(incomplete(cut)).toBe(true);
    expect(incompleteLine(cut)).toBe("Incomplete evidence: 1 unreadable rows · 2 foreign rows · window or source truncated · source refused.");
    expect(incomplete({ truncated: false, integrity: { unreadableRows: 0, foreignRows: 0, sources: [{ path: "home", status: "tail", bytes: 5_000_000 }] } })).toBe(true);
  });
});

describe("each part of the kernel's goes through the display filter, then the line is composed", () => {
  const events = recordedEvents();
  it("a name that ends in a word a secret starts with withholds nothing but what is unsafe", () => {
    expect(setupLine({ capability: "acme.secret", ok: true })).toBe("acme.secret: done");
    expect(claimLine({ producer: "acme.token", waiting: true, since: "2026-11-21T18:30:00.000Z", reason: "attention" })).toBe("acme.token: reported waiting · 2026-11-21T18:30:00.000Z · attention");
    expect(warningLine({ code: "x", message: "vault.api-key never runs here" })).toBe("Warning: vault.api-key never runs here (x)");
    // A message that is itself unsafe is withheld, and the rest of the line stays.
    expect(activitySummary({ ...events, waitingOnYou: { producer: "oats.board", since: "2026-11-21T18:23:39.829Z", message: "set password: hunter2 please" } })).toBe(
      "Waiting claim · 2026-11-21T18:23:39.829Z · Current recorded incarnation · Reported waiting: oats.board since 2026-11-21T18:23:39.829Z — [withheld]",
    );
    expect(producerLine({ producer: "evil\u202Ekernel", incarnation: "current" })).toBe("Producer: evil\uFFFDkernel · Current recorded incarnation");
  });
  it("what a blocked launch's screen differed in: whose text each is, and where", () => {
    expect(differedLines({ nearest: "dev-channel-1", index: 12, expected: "Do you trust this folder?", found: "" })).toEqual({
      leadIn: "Where the screen first differed from the confirmation OATS answers:",
      lines: [{ leadIn: "OATS expected:", text: "Do you trust this folder?" }, { leadIn: "The terminal showed:", text: "(no visible text)" }],
      detail: "Nearest entry dev-channel-1, first difference at 12",
    });
  });
});

describe("a refused read, in the Desktop's own sentence", () => {
  it("by the kernel's code, per read", () => {
    expect(refusalSentence("readiness", "E_HOME_MISMATCH", "")).toBe("The instance home no longer matches its admitted identity.");
    expect(refusalSentence("readiness", "E_UNSUPPORTED_MODE", "")).toBe("Captured incarnation: readiness comes from its resolution, not current configuration.");
    expect(refusalSentence("readiness", "E_AMBIGUOUS_INSTANCE", "")).toBe("The selected instance is ambiguous.");
    expect(refusalSentence("activity", "E_AMBIGUOUS_INSTANCE", "")).toBe("Choose one exact instance home.");
    expect(refusalSentence("activity", "E_HOME_MISMATCH", "")).toBe("The instance home no longer matches the selected address.");
    expect(refusalSentence("activity", "E_UNSUPPORTED_MODE", "")).toBe("Activity is unavailable for this execution mode; no classic fallback.");
  });
  it("by the plugin's own code, for what the Desktop calls a slow, failed or unreadable CLI answer", () => {
    expect(refusalSentence("readiness", "OATS_TIMEOUT", "")).toBe("The readiness read timed out.");
    expect(refusalSentence("activity", "OATS_TIMEOUT", "")).toBe("The activity read timed out.");
    expect(refusalSentence("readiness", "OATS_BAD_ANSWER", "")).toBe("The installed CLI returned invalid or contradictory readiness data.");
    expect(refusalSentence("activity", "OATS_NOT_JSON", "")).toBe("The CLI returned invalid or mismatched activity data.");
    expect(refusalSentence("readiness", "OATS_FAILED", "")).toBe("The installed CLI could not complete the readiness read.");
    expect(refusalSentence("activity", "OATS_OUTPUT_TOO_LARGE", "")).toBe("The activity response exceeded its output limit.");
    expect(refusalSentence("soul", "OATS_BAD_ANSWER", "")).toBe("The installed OATS CLI returned an inspection this plugin cannot read. Update OATS and retry.");
  });
  it("an instance the roster no longer holds; a code with no sentence has none", () => {
    const gone = '"gone-helper" is not an agent of this OATS deployment\'s current snapshot';
    expect(refusalSentence("readiness", null, gone)).toBe("The selected instance is no longer reported.");
    expect(refusalSentence("activity", null, gone)).toBe("The selected instance is no longer in the current roster.");
    expect(refusalSentence("soul", null, gone)).toBeNull();
    expect(refusalSentence("soul", "E_UNSUPPORTED_MODE", "")).toBeNull();
    expect(refusalSentence("readiness", "constructor", "")).toBeNull();
  });
});

describe("readiness' words", () => {
  const home = recordedReadiness("instance");
  const item = (over: Partial<PanelReadinessItem>): PanelReadinessItem => ({ subject: "oats.okf", status: "fail", required: true, producer: null, reason: null, code: null, at: null, file: null, evidence: [], remedy: null, provider: null, problems: [], ...over });
  it("the summary: ready, not established, or how many fail", () => {
    expect(summaryLine(home.summary)).toBe("Ready — every required check passes or is not applicable.");
    expect(summaryLine({ ready: false, required: 0, fail: 0, unknown: 0 })).toBe("Readiness not established — no required checks reported.");
    expect(summaryLine({ ready: false, required: 5, fail: 2, unknown: 1 })).toBe("2 failing · 1 unknown · 5 required checks");
    expect(observedLine("2026-11-21T18:25:22.386Z", "instance")).toBe("Observed: 2026-11-21T18:25:22.386Z. Target: instance. This is not an atomic snapshot or a permission lease.");
    expect(observedLine(null, "soul")).toBe("Observed. Target: soul. This is not an atomic snapshot or a permission lease.");
  });
  it("the recorded checks: their labels and states, and each item on one line", () => {
    expect(home.checks.map((check) => `${checkLabel(check.key)} ${checkState(check)}`)).toEqual(["Installed pass", "Configured not-applicable", "Member pass", "Providers pass"]);
    expect(home.checks.flatMap((check) => check.items.map(itemLine))).toEqual([
      "oats.bb · pass · required", "oats.core · pass · required", "launch · unknown · optional", "member local//abs/real/src/oats-real · pass · required", "oats.bb session backend bb · pass · required · 2 warnings",
    ]);
    expect(itemFacts(home.checks[0]!.items[1]!)).toEqual([{ label: "Producer", value: "instance modules" }, { label: "Origin", value: "package oats.framework 1.26.0 @ 41d8623" }]);
    expect(itemFacts(home.checks[1]!.items[0]!).map((fact) => fact.label)).toEqual(["Producer", "Reason", "Code", "Configuration file"]);
    const provider = home.checks[3]!.items[0]!.provider!;
    expect(providerSays(provider.status)).toBe("The provider says: ready.");
    expect(warningLine(provider.warnings[1]!)).toMatch(/^Warning: the bb backend launches in bb's full mode only .* \(session-provider-full-mode-only\)$/);
  });
  it("a check failing only because providers need a sign-in is its own state; the provider's answer is said as it gave it", () => {
    const signIn = item({ provider: { status: "authorization-required", problems: [], warnings: [] } });
    expect(checkState({ key: "providers", status: "fail", items: [signIn] })).toBe("sign in needed");
    expect(checkState({ key: "providers", status: "fail", items: [signIn, item({})] })).toBe("fail");
    expect(itemLine(signIn)).toBe("oats.okf · sign in needed · required");
    expect(["needs-configuration", "authorization-required", "unavailable", "toString"].map(providerSays)).toEqual([
      "The provider says: needs configuration.", "Sign in needed: the provider is set up but is not signed in.", "The provider says: unavailable right now.", "The provider answered: toString.",
    ]);
  });
  it("an item's reason is said once with its problem's code; another problem is a line of its own; where it is declared, in words", () => {
    const failing = item({
      reason: "setting state-dir is required", at: "oats-local.yaml#/settings/oats.okf/state-dir", remedy: "set state-dir",
      provider: { status: "needs-configuration", problems: [{ code: "needs-configuration", message: "setting state-dir is required" }, { code: "other", message: "another thing" }], warnings: [] },
      problems: [{ code: null, message: "no code" }],
    });
    expect(itemFacts(failing)).toEqual([
      { label: "Reason", value: "setting state-dir is required" }, { label: "Declared in", value: "oats-local.yaml › settings › oats.okf › state-dir, on this computer" },
      { label: "Remedy (display only)", value: "set state-dir" }, { label: "Problem code", value: "needs-configuration" },
    ]);
    expect(itemProblems(failing)).toEqual(["another thing (other)", "no code"]);
    expect(declaredIn("package:oats.framework:oats.json#/settings/a~1b")).toBe("oats.json › settings › a/b, in the oats.framework package");
    expect(declaredIn("github.com/nw/agents:souls/rm/soul.yaml#/launch")).toBe("souls/rm/soul.yaml › launch, in github.com/nw/agents");
    expect(declaredIn("somewhere")).toBe("somewhere");
  });
  it("the policy, a line per authority", () => {
    expect(home.policy!.map(policyLine)).toEqual([
      "Child spawns: allowed · enforced · default: no spawn option: children allowed",
      "Worktrees: allowed · enforced · work-mode: work: worktree · mode worktree",
    ]);
    expect(policyLine({ key: "childSpawns", allowed: null, enforced: false, origin: "soul", detail: null, mode: null })).toBe("Child spawns: unknown · advisory, not enforced · soul");
    expect(policyLine({ key: "other", allowed: false, enforced: true, origin: "x", detail: null, mode: null })).toBe("other: not allowed · enforced · x");
  });
});
