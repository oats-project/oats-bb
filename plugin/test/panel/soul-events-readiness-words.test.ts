// The words of the Soul tab's body, of the recorded activity and of readiness: the OATS Desktop's,
// for the answers recorded from the real kernel.
import { describe, expect, it } from "vitest";
import { differedLines, eventFacts, eventTitle, incomplete, incompleteLine, producerLine, setupLine, sourcesLine, summaryLine as activitySummary, windowLine } from "../../app/panel/events-words";
import { refusalWords } from "../../app/panel/refusal-words";
import { whenText } from "../../app/panel/words";

/** A refusal's sentence alone. */
const refusalSentence = (read: "readiness" | "activity" | "soul", code: string | null, error: string) => refusalWords(read, code, error).sentence;

/** The clock the lines with an instant are said at. */
const NOW = Date.parse("2026-11-21T18:29:30.000Z");
import { checkLabel, checkState, declaredIn, itemFacts, itemLine, itemProblems, observedLine, policyLine, providerSays, summaryLine, warningLine } from "../../app/panel/readiness-words";
import { coreNote, emptySlot, layerLabel, MODULES_AS_SPAWNED, sourceKind, sourceText, sourceWhole, spawnedFrom, whyTag } from "../../app/panel/soul-words";
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
    expect(MODULES_AS_SPAWNED).toBe("Modules as spawned");
    // a commit id as a version is drawn short, and is whole for the line's title
    const pinned = { kind: "package" as const, name: "oats.bb", version: "a3cca8511461e92c25d86f693365ec250b7c4684" };
    expect([sourceText(pinned), sourceWhole(pinned)]).toEqual(["oats.bb a3cca85", "oats.bb a3cca8511461e92c25d86f693365ec250b7c4684"]);
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
    // The last event alone: what the agent waits for is said by the panel's header, from the roster as it is now.
    expect(activitySummary(events, NOW)).toBe(`Waiting claim · ${whenText("2026-11-21T18:23:39.829Z", NOW)} · Current recorded incarnation`);
    expect(activitySummary({ ...events, events: [], waitingOnYou: null }, NOW)).toBe("No recorded lifecycle events in this observed window.");
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
    expect(warningLine({ code: "x", message: "vault.api-key never runs here" })).toBe("Warning: vault.api-key never runs here (x)");
    // A message that is itself unsafe is withheld, and the rest of the line stays.
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
    // In a person's words where the Desktop's sentence is an instruction nobody can follow from here, or the kernel's terms.
    expect(refusalSentence("readiness", "E_HOME_MISMATCH", "")).toBe("This agent's folder is no longer the one OATS recorded for it.");
    expect(refusalSentence("readiness", "E_UNSUPPORTED_MODE", "")).toBe("OATS has no readiness check for this kind of agent.");
    expect(refusalSentence("readiness", "E_AMBIGUOUS_INSTANCE", "")).toBe("OATS knows more than one agent by this name here, so it cannot say which one this is.");
    expect(refusalSentence("readiness", "E_SOUL_UNKNOWN", "")).toBe("OATS does not list this soul in this deployment.");
    expect(refusalSentence("activity", "E_AMBIGUOUS_INSTANCE", "")).toBe("OATS knows more than one agent by this name here, so it cannot say which one this is.");
    expect(refusalSentence("activity", "E_HOME_MISMATCH", "")).toBe("This agent's folder is no longer the one OATS recorded for it.");
    expect(refusalSentence("activity", "E_UNSUPPORTED_MODE", "")).toBe("OATS keeps no activity for this kind of agent.");
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
    expect(refusalSentence("readiness", null, gone)).toBe("OATS no longer lists this agent.");
    expect(refusalSentence("activity", null, gone)).toBe("OATS no longer lists this agent.");
    expect(refusalSentence("soul", null, gone)).toBe("OATS no longer lists this agent.");
    expect(refusalSentence("soul", "E_UNSUPPORTED_MODE", "")).toBe("OATS keeps no record of what this kind of agent was spawned from.");
    // a refusal of the kernel's with no sentence of its own still says, in words, that OATS refused
    expect(refusalSentence("soul", "E_SOMETHING_NEW", "")).toBe("OATS refused to read what this agent was spawned from.");
    expect(refusalSentence("activity", "E_SOMETHING_NEW", "")).toBe("OATS refused to read the activity.");
    expect(refusalSentence("readiness", "E_SOMETHING_NEW", "")).toBe("OATS refused to read readiness.");
    // a failure with no code of the kernel's has none
    expect(refusalSentence("readiness", "constructor", "")).toBeNull();
    expect(refusalSentence("readiness", "OATS_ABORTED", "")).toBeNull();
  });
  it("says what to do next, and offers Retry only where reading again can change the answer", () => {
    expect(refusalWords("readiness", "E_HOME_MISMATCH", "")).toEqual({
      sentence: "This agent's folder is no longer the one OATS recorded for it.", next: "`oats status`, on the machine that holds it, shows where the agent is now.", retry: false,
    });
    expect(refusalWords("activity", "E_AMBIGUOUS_INSTANCE", "")).toMatchObject({ next: "Retire or rename one of them with OATS, on the machine that holds them.", retry: false });
    expect(refusalWords("readiness", "E_SOUL_UNKNOWN", "")).toMatchObject({ next: "It may have been removed from the workspace: `oats souls` lists the ones there are.", retry: false });
    expect(refusalWords("soul", "E_UNSUPPORTED_MODE", "")).toMatchObject({ next: "There is nothing to do: OATS has none for it.", retry: false });
    expect(refusalWords("readiness", "E_USAGE", "")).toEqual({ sentence: "The OATS installed here is too old for this. Update OATS.", next: null, retry: false });
    expect(refusalWords("activity", null, '"gone-helper" is not an agent of this OATS deployment\'s current snapshot')).toEqual({
      sentence: "OATS no longer lists this agent.", next: "It may have been retired: the sidebar lists the agents OATS has.", retry: false,
    });
    // A slow, failed or unreadable answer, and a refusal nobody has words for yet, may go better next time.
    expect(refusalWords("readiness", "OATS_TIMEOUT", "")).toEqual({ sentence: "The readiness read timed out.", next: null, retry: true });
    expect(refusalWords("soul", "E_SOMETHING_NEW", "")).toMatchObject({ next: null, retry: true });
    expect(refusalWords("activity", null, "boom")).toEqual({ sentence: null, next: null, retry: true });
  });
});

describe("readiness' words", () => {
  const home = recordedReadiness("instance");
  const item = (over: Partial<PanelReadinessItem>): PanelReadinessItem => ({ subject: "oats.okf", status: "fail", required: true, producer: null, reason: null, code: null, at: null, file: null, evidence: [], remedy: null, provider: null, problems: [], ...over });
  it("the summary: ready, not established, or how many fail", () => {
    expect(summaryLine(home.summary)).toBe("Ready — every required check passes or is not applicable.");
    expect(summaryLine({ ready: false, required: 0, fail: 0, unknown: 0 })).toBe("Readiness not established — no required checks reported.");
    expect(summaryLine({ ready: false, required: 5, fail: 2, unknown: 1 })).toBe("2 failing · 1 unknown · 5 required checks");
    expect(observedLine("2026-11-21T18:25:22.386Z", "instance", NOW)).toBe(`Observed: ${whenText("2026-11-21T18:25:22.386Z", NOW)}. Target: instance. This is not an atomic snapshot or a permission lease.`);
    expect(observedLine(null, "soul", NOW)).toBe("Observed. Target: soul. This is not an atomic snapshot or a permission lease.");
  });
  it("the recorded checks: their labels and states, and each item on one line", () => {
    expect(home.checks.map((check) => `${checkLabel(check.key)} ${checkState(check)}`)).toEqual(["Installed pass", "Configured not-applicable", "Member pass", "Providers pass"]);
    expect(home.checks.flatMap((check) => check.items.map(itemLine))).toEqual([
      "oats.bb · pass · required", "oats.core · pass · required", "launch · unknown · optional", "member local//abs/real/src/oats-real · pass · required", "oats.bb session backend bb · pass · required · 2 warnings",
    ]);
    expect(itemFacts(home.checks[0]!.items[1]!)).toEqual([{ label: "Producer", value: "instance modules", whole: null }, { label: "Origin", value: "package oats.framework 1.26.0 @ 41d8623", whole: null }]);
    // a commit id inside a value is drawn by its first seven, never broken inside; the whole value is the fact's title
    expect(itemFacts(home.checks[0]!.items[0]!)[1]).toEqual({ label: "Origin", value: "package oats.bb a3cca85 @ a3cca85", whole: "package oats.bb a3cca8511461e92c25d86f693365ec250b7c4684 @ a3cca85" });
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
    expect(itemFacts(failing).map(({ label, value }) => ({ label, value }))).toEqual([
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
