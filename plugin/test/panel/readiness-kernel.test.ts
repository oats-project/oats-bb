// `oats readiness`, read into the panel's checks: against the answers recorded from the real kernel
// for an instance's home and for its soul, and against the home's answer changed for what the
// recording's deployment does not hold (a failing provider, a sign-in, a declared team).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { originText, panelReadiness, panelReadinessArgv, panelSoulReadinessArgv, parsePanelReadiness } from "../../kernel/panel-readiness.js";

type Answer = Record<string, unknown> & { checks: Record<string, { status: string; items: Record<string, unknown>[] }>; summary: Record<string, unknown> };
const recorded = (name: string): Answer => structuredClone((JSON.parse(readFileSync(resolve(process.cwd(), "test/fixtures/panel", name), "utf8")) as { result: Answer }).result);
const HOME = "/abs/deployment/agents/oats-expert/instances/panel-worktree-helper";

describe("the readiness read", () => {
  it("asks about the home the kernel named, or a soul the kernel lists, with the policy", () => {
    expect(panelReadinessArgv(HOME)).toEqual({ ok: true, value: ["readiness", "--home", HOME, "--policy", "--json"] });
    expect(panelReadinessArgv("home").ok).toBe(false);
    expect(panelSoulReadinessArgv("oats.okf/knowledge-harvester", ["oats-expert", "oats.okf/knowledge-harvester"])).toEqual({
      ok: true, value: ["readiness", "--soul", "oats.okf/knowledge-harvester", "--policy", "--json"],
    });
    expect(panelSoulReadinessArgv("--home", ["--home"]).ok).toBe(false);
    expect(panelSoulReadinessArgv("unknown", ["oats-expert"])).toEqual({ ok: false, error: { code: "INVALID_INPUT", message: '"unknown" is not a soul `oats souls` lists for this deployment' } });
  });

  it("the recorded home: ready, its four checks, the provider's own answer with its warnings, and the policy", () => {
    const answer = parsePanelReadiness(recorded("readiness-home.json"));
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(panelReadiness.parse(answer.value)).toEqual(answer.value);
    expect(answer.value.summary).toEqual({ ready: true, required: 4, fail: 0, unknown: 0 });
    expect(answer.value.checks.map((check) => `${check.key} ${check.status} ${check.items.length}`)).toEqual(["installed pass 2", "configured not-applicable 1", "member pass 1", "providers pass 1"]);
    expect(answer.value.checks[0]?.items[1]).toEqual({
      subject: "oats.core", status: "pass", required: true, producer: "instance modules", reason: null, code: null, at: null, file: null,
      evidence: [{ name: "Origin", value: "package oats.framework 1.26.0 @ 41d8623" }], remedy: null, provider: null, problems: [],
    });
    expect(answer.value.checks[1]?.items[0]).toMatchObject({ subject: "launch", status: "not-applicable", required: false, producer: "harness folder trust", code: "harness-trust", file: null });
    expect(answer.value.checks[2]?.items[0]?.evidence).toEqual([
      { name: "repoKey", value: "local//abs/real/src/oats-real" }, { name: "workspace", value: "local//abs/real/src/oats-real" }, { name: "commit", value: "bd67121a08cf55224dd4053449dd7220e54ba643" },
    ]);
    const provider = answer.value.checks[3]?.items[0];
    expect(provider).toMatchObject({ subject: "oats.bb session backend bb", status: "pass", producer: "session provider check", provider: { status: "ready", problems: [] } });
    expect(provider?.provider?.warnings.map((warning) => warning.code)).toEqual(["session-provider-sandbox-unsupported", "session-provider-full-mode-only"]);
    expect(answer.value.policy).toEqual([
      { key: "childSpawns", allowed: true, enforced: true, origin: "default", detail: "no spawn option: children allowed", mode: null },
      { key: "worktrees", allowed: true, enforced: true, origin: "work-mode", detail: "work: worktree", mode: "worktree" },
    ]);
    expect(answer.value.notes).toHaveLength(4);
    expect(answer.value.warnings).toEqual([]);
  });

  it("the recorded home when the kernel cannot run bb: not ready, the provider's own answer and its problem", () => {
    const answer = parsePanelReadiness(recorded("readiness-home-not-ready.json"));
    expect(answer.ok && answer.value.summary).toEqual({ ready: false, required: 4, fail: 1, unknown: 0 });
    if (!answer.ok) return;
    expect(answer.value.checks.map((check) => `${check.key} ${check.status}`)).toEqual(["installed pass", "configured not-applicable", "member pass", "providers fail"]);
    const reason = "the bb version could not be read (cannot run bb: spawn bb ENOENT: install bb-app or set settings.oats.bb.cli)";
    expect(answer.value.checks[3]?.items[0]).toMatchObject({
      subject: "oats.bb session backend bb", status: "fail", required: true, reason, remedy: null,
      provider: { status: "needs-configuration", problems: [{ code: "E_BACKEND_VERSION", message: reason }] },
    });
  });

  it("the recorded soul: three required checks, and a policy that is not enforced yet", () => {
    const answer = parsePanelReadiness(recorded("readiness-soul.json"));
    expect(answer.ok && answer.value.summary).toEqual({ ready: true, required: 3, fail: 0, unknown: 0 });
    expect(answer.ok && answer.value.policy).toEqual([
      { key: "childSpawns", allowed: true, enforced: false, origin: "default", detail: "no declaration: children allowed", mode: null },
      { key: "worktrees", allowed: true, enforced: false, origin: "soul", detail: "work: worktree", mode: "worktree" },
    ]);
  });

  it("a failing provider, a sign-in, a declared team, problems and warnings are read as the kernel gave them", () => {
    const document = recorded("readiness-home.json");
    document.checks.providers = {
      status: "fail",
      items: [
        { subject: "oats.okf", status: "fail", required: true, reason: "setting state-dir is required", producer: "provider binding check", evidence: null, remedy: "set state-dir",
          result: { status: "needs-configuration", problems: [{ code: "needs-configuration", message: "setting state-dir is required" }, { code: "x" }], warnings: [] } },
        { subject: "oats.aweb", status: "fail", required: true, reason: "sign in", producer: "provider binding check", result: { status: "authorization-required", problems: [], warnings: [] } },
        { subject: "team eng", status: "unknown", required: false, at: "oats-local.yaml#/teams/eng", problems: [{ code: "team-unmapped", message: "eng is not mapped" }], evidence: { from: { kind: "member", repoKey: "github.com/nw/agents.git", commit: "665665121234" }, count: 3, nested: {} } },
      ],
    };
    document.summary = { ready: false, required: 5, pass: 3, fail: 2, unknown: 0 };
    document.warnings = [{ code: "hook-event-unsupported", capability: "oats.core", path: "oats.json", message: "a hook never runs here" }, { code: "no message" }];
    delete document.policy;
    const answer = parsePanelReadiness(document);
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.value.summary).toEqual({ ready: false, required: 5, fail: 2, unknown: 0 });
    const [okf, aweb, team] = answer.value.checks[3]!.items;
    expect(okf).toMatchObject({ reason: "setting state-dir is required", remedy: "set state-dir", provider: { status: "needs-configuration", problems: [{ code: "needs-configuration", message: "setting state-dir is required" }] } });
    expect(aweb?.provider?.status).toBe("authorization-required");
    expect(team).toMatchObject({ at: "oats-local.yaml#/teams/eng", provider: null, problems: [{ code: "team-unmapped", message: "eng is not mapped" }], evidence: [{ name: "Origin", value: "member agents @ 6656651" }, { name: "count", value: "3" }] });
    expect(answer.value.warnings).toEqual([{ code: "hook-event-unsupported", capability: "oats.core", path: "oats.json", message: "a hook never runs here" }]);
    expect(answer.value.policy).toBeNull();
  });

  it("an origin in one line", () => {
    expect(originText({ kind: "package", package: "oats.okf", version: "2.1.3", commit: "ab897841ffff" })).toBe("package oats.okf 2.1.3 @ ab89784");
    expect(originText({ kind: "package" })).toBe("package ?");
    expect(originText({ kind: "member", repoKey: "github.com/nw/agents", commit: "not a commit" })).toBe("member agents");
    expect(originText({ kind: "local" })).toBe("local");
    expect(originText(null)).toBe("Not reported");
  });

  it("an answer of another readiness API, or with no summary, is the plugin's own error", () => {
    const old = parsePanelReadiness({ ...recorded("readiness-home.json"), readinessApi: 1 });
    expect(!old.ok && old.error.code).toBe("OATS_BAD_ANSWER");
    const cut = recorded("readiness-home.json") as Record<string, unknown>;
    delete cut.summary;
    expect(parsePanelReadiness(cut).ok).toBe(false);
  });
});
