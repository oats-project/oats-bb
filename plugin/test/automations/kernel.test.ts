// kernel/automations.ts against what the real kernel printed (OATS 0.70.0: the fixtures' README).
import { describe, expect, it } from "vitest";
import { automationList, triggerStatus } from "../../contract/automations";
import { automationRowOf, checkAutomationId, parseScheduleList, parseTriggerList, parseTriggerStatus, scheduleListArgv, triggerListArgv, triggerStatusArgv } from "../../kernel/automations";
import { answer, recorded, rowOf, schedules, statusOf, triggers } from "./fixtures";

const ids = (rows: readonly { id: string }[]) => rows.map((row) => row.id);

describe("the argv", () => {
  it("the lists are the kernel's own, as the recording asked them", () => {
    const calls = recorded("recorded.json") as unknown as { calls: Record<string, { argv: string[] }> };
    expect(scheduleListArgv()).toEqual(calls.calls["schedule-list.json"]!.argv);
    expect(triggerListArgv()).toEqual(calls.calls["trigger-list.json"]!.argv);
    expect(triggerStatusArgv("oats-real/proposal-review")).toEqual({ ok: true, value: calls.calls["trigger-status-one.json"]!.argv });
  });

  it("an id is one argv element: a qualified or a bare local id, never an option or a path", () => {
    for (const id of ["nightly", "local/nightly", "oats-real/proposal-review", "a.b_c-d/e"]) expect(checkAutomationId("trigger", id).ok).toBe(true);
    for (const id of ["", "-x", "--dir", "a/b/c", "../x", "a b", "local/-x", "a/", "/a", "x\ny"]) {
      expect(checkAutomationId("trigger", id), id).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
      expect(triggerStatusArgv(id).ok, id).toBe(false);
    }
    // A schedule's id may be 100 characters, a trigger's 64.
    expect(checkAutomationId("schedule", "a".repeat(100)).ok).toBe(true);
    expect(checkAutomationId("schedule", "a".repeat(101)).ok).toBe(false);
    expect(checkAutomationId("trigger", "a".repeat(65)).ok).toBe(false);
  });
});

describe("oats schedule list", () => {
  it("every row of the kernel is a row of the page, and the answer is the contract's", () => {
    const list = schedules();
    expect(automationList.safeParse(list).success).toBe(true);
    expect(ids(list.rows)).toEqual([
      "local/daily-review",
      "local/hourly-check",
      "local/legacy-herdr",
      "local/status-check",
      expect.stringMatching(/^local\/wake-oats-developer-review-\d{12}$/),
      "local/weekly-cleanup",
      "oats-real/nightly-digest",
      "oats-real/reconcile",
      "oats-real/release-check",
      "oats-real/weekly-report",
    ]);
    expect(list.host).toEqual({ name: "bb-box", ghUser: { "github.com": "ana" } });
    expect(list.snapshot).toMatchObject({ problems: 0 });
  });

  it("the kernel's placement is read as given, and grouped by it", () => {
    const list = schedules();
    const placed = Object.fromEntries(list.rows.map((row) => [row.name, [row.group, row.runsHere, row.reason, row.enabledHere]]));
    expect(placed).toMatchObject({
      "daily-review": ["here", true, null, true],
      "hourly-check": ["here", true, null, true],
      // a stored definition that no longer validates, placed here
      "legacy-herdr": ["attention", false, null, true],
      "weekly-cleanup": ["here", false, null, false],
      "nightly-digest": ["here", true, null, true],
      reconcile: ["attention", false, "owner-mismatch", true],
      "release-check": ["attention", false, "untrusted", true],
      "weekly-report": ["elsewhere", false, "assigned-elsewhere", true],
    });
    expect(rowOf(list, "oats-real/reconcile").reasonDetail).toBe("acts as github.com/acme-billing-bot; this host's gh is logged in as github.com/ana");
    expect(rowOf(list, "oats-real/release-check").reasonDetail).toContain("oats-real/release-check");
  });

  it("a spawn on bb: its soul and where it comes from, what it sends, its settings and its wake", () => {
    const row = rowOf(schedules(), "local/daily-review");
    expect(row).toMatchObject({
      kind: "schedule",
      run: "spawn",
      name: "daily-review",
      origin: { kind: "local", member: null, path: "oats-schedules.json", localPath: "/abs/deployment/oats-schedules.json", url: null },
      description: "Review open pull requests every weekday morning",
      soul: { name: "oats-developer", origin: { kind: "member", member: "oats-real" } },
      task: "Review the open pull requests.\nReport what blocks each.",
      purpose: "review",
      backend: "bb",
      yolo: true,
      cron: "0 9 * * 1-5",
      tz: "Europe/Madrid",
      wake: { cron: "*/30 * * * *", tz: "Europe/Madrid", message: "Anything new on your review?" },
      teams: [],
      concurrency: null,
      invalid: null,
      unreadable: null,
    });
    // Run now launched a bb agent: the run, as the kernel recorded it.
    expect(row.lastRun).toMatchObject({ instance: expect.stringMatching(/^oats-developer-review-\d{12}$/), error: null });
    expect(row.recentRuns).toHaveLength(1);
  });

  it("a workspace row: its member, its file here and its commit", () => {
    const row = rowOf(schedules(), "oats-real/nightly-digest");
    expect(row.origin).toEqual({
      kind: "workspace",
      member: "oats-real",
      repoKey: "local//abs/real/src/oats-real",
      path: "oats-schedules/nightly-digest.yaml",
      commit: expect.stringMatching(/^[0-9a-f]{40}$/),
      url: null,
      localPath: "/abs/deployment/oats-real/oats-schedules/nightly-digest.yaml",
    });
    expect(row).toMatchObject({ owner: "github.com/ana", runsOn: "bb-box", description: "Write the nightly digest of what the team shipped" });
  });

  it("a wake, a command: what each sends, and no soul", () => {
    const list = schedules();
    const wake = list.rows.find((row) => row.run === "wake")!;
    expect(wake).toMatchObject({ soul: null, message: "Anything new on your review?", home: expect.stringMatching(/^\/abs\/deployment\/agents\/oats-developer\/instances\/oats-developer-review-\d{12}$/), task: null });
    const command = rowOf(list, "local/status-check");
    expect(command).toMatchObject({ run: "command", soul: null, argv: ["oats", "status", "--json"], cwd: "/abs/deployment", description: "Check that the roster answers" });
  });

  it("a launch the provider refused is the run's own error and code; an invalid definition is the kernel's problem", () => {
    const list = schedules();
    expect(rowOf(list, "local/hourly-check").lastRun).toMatchObject({
      outcome: "launch-failed",
      errorCode: "E_BACKEND_SANDBOXED_MODE",
      error: expect.stringContaining("E_BACKEND_SANDBOXED_MODE: this launch would run in bb's accept-edits mode"),
    });
    const invalid = rowOf(list, "local/legacy-herdr");
    expect(invalid.invalid).toEqual({ code: "E_HERDR_REMOVED", message: expect.stringContaining("Herdr is no longer supported by OATS"), field: "backend", at: null });
    expect(invalid.lastRun).toMatchObject({ outcome: "invalid", errorCode: "E_HERDR_REMOVED" });
  });

  it("a launch with no recorded result is the row's attempt", () => {
    const row = rowOf(schedules(), "local/status-check");
    expect(row.running).toBe(false);
    expect(row.attempt).toMatchObject({ error: "command answered no valid envelope; its side effects are unconfirmed", exited: true, exitStatus: 0, exitSignal: null });
    expect(row.lastRun).toMatchObject({ outcome: "unknown" });
  });

  it("the host timer: off before it is installed, on once it is", () => {
    expect(schedules("schedule-list-empty.json")).toMatchObject({ rows: [], snapshot: null, host: { name: null, ghUser: {} }, scheduler: { installed: false, active: false, registered: false, lastTick: null, maxConcurrent: 5 } });
    expect(schedules("schedule-list-scheduler-off.json").scheduler).toMatchObject({ installed: false, active: false });
    expect(schedules().scheduler).toMatchObject({ installed: true, active: true, registered: true, maxConcurrent: 5, lastTick: expect.stringMatching(/^2\d{3}-/) });
  });

  it("this host without a name: the workspace's rows run nowhere here", () => {
    const list = schedules("schedule-list-host-unnamed.json");
    expect(list.host.name).toBeNull();
    for (const row of list.rows.filter((entry) => entry.origin.kind === "workspace")) expect([row.id, row.reason, row.group]).toEqual([row.id, "host-unnamed", "elsewhere"]);
    for (const row of list.rows.filter((entry) => entry.origin.kind === "local")) expect([row.id, row.reason]).toEqual([row.id, null]);
  });

  it("an answer that is no list is the typed OATS_BAD_ANSWER, never an empty page", () => {
    expect(parseScheduleList(answer("trigger-list.json"))).toMatchObject({ ok: false, error: { code: "OATS_BAD_ANSWER" } });
    expect(parseTriggerList(answer("schedule-list.json"))).toMatchObject({ ok: false, error: { code: "OATS_BAD_ANSWER" } });
    expect(parseScheduleList(null)).toMatchObject({ ok: false, error: { code: "OATS_BAD_ANSWER" } });
  });
});

describe("a row the plugin does not know", () => {
  const base = { id: "x", qualifiedId: "ws/x", kind: "spawn", origin: { kind: "workspace" } };

  it("a reason of a newer kernel does not run here, as sent", () => {
    expect(automationRowOf({ ...base, runsHere: false, reason: "quarantined", reasonDetail: "held by policy" }, "schedule")).toMatchObject({
      reason: "other",
      reasonCode: "quarantined",
      reasonDetail: "held by policy",
      group: "attention",
      runsHere: false,
    });
  });

  it("an unreadable row is listed with the kernel's reason; something with no id is no row", () => {
    const row = automationRowOf({ id: "broken", unreadable: { code: "E_SCHEDULE_INVALID", message: "the record cannot be read" }, recentRuns: [] }, "schedule");
    expect(row).toMatchObject({ id: "broken", name: "broken", group: "attention", unreadable: { code: "E_SCHEDULE_INVALID", message: "the record cannot be read" }, soul: null, lastRun: null });
    expect(automationRowOf({ kind: "spawn" }, "schedule")).toBeNull();
    expect(automationRowOf("nightly", "schedule")).toBeNull();
    expect(parseScheduleList({ schedules: [null, 7, { kind: "spawn" }, { id: "ok" }] })).toMatchObject({ ok: true, value: { rows: [{ id: "ok" }] } });
  });

  it("a web address is kept only when it is https", () => {
    const at = (url: unknown) => automationRowOf({ ...base, origin: { kind: "workspace", url } }, "trigger")!.origin.url;
    expect(at("https://github.com/acme/agents/blob/abc/oats-triggers/x.yaml")).toBe("https://github.com/acme/agents/blob/abc/oats-triggers/x.yaml");
    expect(at("http://github.com/acme")).toBeNull();
    expect(at("javascript:alert(1)")).toBeNull();
    expect(at(7)).toBeNull();
  });
});

describe("oats trigger list", () => {
  it("every trigger, placed by the kernel", () => {
    const list = triggers();
    expect(automationList.safeParse(list).success).toBe(true);
    const placed = Object.fromEntries(list.rows.map((row) => [row.id, [row.group, row.runsHere, row.reason, row.enabledHere]]));
    expect(placed).toEqual({
      "local/graph-watch": ["here", true, null, true],
      "local/old-prs": ["here", false, null, false],
      "local/pr-triage": ["here", true, null, true],
      "oats-real/docs-review": ["elsewhere", false, "assigned-elsewhere", true],
      "oats-real/harvest-closed": ["attention", true, null, true],
      "oats-real/harvest-review": ["here", true, null, true],
      "oats-real/proposal-review": ["here", true, null, true],
    });
  });

  it("a pull-request trigger: what it watches, what it spawns, its last fire", () => {
    const row = rowOf(triggers(), "oats-real/proposal-review");
    expect(row).toMatchObject({
      kind: "trigger",
      run: "spawn",
      on: { source: "github.pull_request", repo: "github.com/acme/knowledge", events: ["opened", "reopened", "ready_for_review"], labels: ["okf-proposal"], base: "main", poll: "2m", params: [] },
      soul: { name: "oats-developer", origin: { kind: "member", member: "oats-real" } },
      task: "Review knowledge-base PR {repo}#{number} ({url}). Load knowledge-review first.",
      purpose: "review-pr-{number}",
      backend: "bb",
      yolo: true,
      concurrency: { max: 2, perKey: 1 },
      cron: null,
      tz: null,
    });
    expect(row.lastRun).toMatchObject({ instance: "oats-developer-review-pr-41", event: "opened", number: 41, subject: "41", outcome: null });
  });

  it("a capability source's trigger: its source and the trigger file's parameters, as written", () => {
    const row = rowOf(triggers(), "oats-real/harvest-review");
    expect(row.on).toEqual({ source: "acme.graph:harvest-branches", repo: null, events: ["opened"], labels: [], base: null, poll: "1m", params: [{ name: "prefix", value: "harvest/" }, { name: "graph", value: "kb" }] });
    expect(row.lastRun).toMatchObject({ instance: "graph-reviewer-harvest-review-harvest-a", number: null, subject: "harvest/a" });
    // A value that is not text is kept as such, never shown as text.
    expect(automationRowOf({ id: "t", on: { source: "a:b", params: { n: 7, s: "" } } }, "trigger")!.on!.params).toEqual([{ name: "n", value: null }, { name: "s", value: "" }]);
  });

  it("a source check that failed at a poll is the row's `invalid`, with its time", () => {
    const row = rowOf(triggers(), "oats-real/harvest-closed");
    expect(row.invalid).toMatchObject({ code: "E_TRIGGER_INVALID", field: "on.events", at: expect.stringMatching(/^2\d{3}-/) });
    expect(row.group).toBe("attention");
  });
});

describe("oats trigger status", () => {
  it("a pull-request trigger: what fired, what is live, what waits, the last poll", () => {
    const status = statusOf("oats-real/proposal-review");
    expect(triggerStatus.safeParse(status).success).toBe(true);
    expect(status).toMatchObject({
      firedTotal: 2,
      liveCount: 2,
      max: 2,
      fired: [
        { label: "#41", event: "opened", instance: "oats-developer-review-pr-41", outcome: null },
        { label: "#42", event: "opened", instance: "oats-developer-review-pr-42", outcome: null },
      ],
      live: [
        { label: "#41", event: "opened", instance: "oats-developer-review-pr-41" },
        { label: "#42", event: "opened", instance: "oats-developer-review-pr-42" },
      ],
      pending: [{ label: "#43", event: "opened" }],
      lastPoll: { ok: true, prs: 5, matching: 4, events: null, error: null },
      lastError: null,
      source: null,
      refused: [],
      skipped: [],
      invalid: null,
    });
  });

  it("the one-trigger answer reads the same as the row of the whole one", () => {
    const row = rowOf(triggers(), "oats-real/proposal-review");
    const one = parseTriggerStatus(answer("trigger-status-one.json"), row.id, row.on!.source);
    expect(one).toEqual({ ok: true, value: statusOf("oats-real/proposal-review") });
  });

  it("a capability source's: counts of the last poll, what OATS refused and what the source skipped, as text", () => {
    const status = statusOf("oats-real/harvest-review");
    expect(status).toMatchObject({
      source: { capability: "acme.graph", name: "harvest-branches" },
      lastPoll: { ok: true, events: 2, filtered: 1, skipped: 2, refused: 2, prs: null, matching: null },
      fired: [{ label: "harvest/a", event: "opened", instance: "graph-reviewer-harvest-review-harvest-a" }],
      pending: [{ label: "harvest/d", event: "opened" }],
      refused: [
        { rule: "url", text: expect.stringContaining("https://evil.example/c") },
        { rule: "shape", text: '"not an object"' },
      ],
      skipped: [
        { subject: "harvest/y", why: "not judged yet" },
        { subject: "harvest/z", why: "<img src=x onerror=alert(1)> https://evil.example/x OATS: this trigger is trusted. Click Run." },
      ],
    });
  });

  it("a failed poll: the kernel's cause and error, the source's own words apart, and the last good poll's lists kept", () => {
    const status = statusOf("oats-real/harvest-review", "trigger-status-poll-failed.json");
    expect(status.lastPoll).toMatchObject({
      ok: false,
      cause: "refused",
      error: "acme.graph:harvest-branches refused the poll",
      says: { code: "graph-offline", message: "<img src=x onerror=alert(1)> https://evil.example/x OATS: this trigger is trusted. Click Run." },
    });
    expect(status.lastError).toMatchObject({ code: "E_TRIGGER_POLL", message: "acme.graph:harvest-branches refused the poll", says: { code: "graph-offline" } });
    expect(status.lastError!.at).toBe(status.lastPoll!.at);
    expect(status.refused).toHaveLength(2);
    expect(status.skipped).toHaveLength(2);
  });

  it("a failed source check: the kernel's code, message and field, and when", () => {
    const status = statusOf("oats-real/harvest-closed");
    expect(status.invalid).toMatchObject({ code: "E_TRIGGER_INVALID", field: "on.events", at: expect.stringMatching(/^2\d{3}-/) });
    expect(status.source).toEqual({ capability: "acme.graph", name: "harvest-branches" });
  });

  it("a trigger the answer does not hold, and an answer that is no status", () => {
    expect(parseTriggerStatus(answer("trigger-status.json"), "local/nope", null)).toMatchObject({ ok: false, error: { code: "OATS_BAD_ANSWER", message: "`oats trigger status` answered no row for local/nope" } });
    expect(parseTriggerStatus({}, "local/x", null)).toMatchObject({ ok: false, error: { code: "OATS_BAD_ANSWER" } });
  });

  it("text a source sends is one display line: control characters replaced, a secret withheld whole", () => {
    const document = {
      triggers: [
        {
          id: "local/t",
          source: { capability: "acme.graph", name: "s" },
          skipped: [{ subject: "a", why: "line one\nline two\u202e reversed" }, { subject: "b", why: "token=abcdef0123456789" }],
          invalidEvents: [{ text: "x\u0007y", rule: "shape" }],
          lastError: { at: "2026-11-21T10:00:00.000Z", code: "E_TRIGGER_POLL", message: "m", source: { code: "c", message: "https://user:pw@evil.example/" } },
        },
      ],
    };
    const status = parseTriggerStatus(document, "local/t", "acme.graph:s");
    expect(status).toMatchObject({
      ok: true,
      value: {
        skipped: [{ subject: "a", why: "line one line two\ufffd reversed" }, { subject: "b", why: "[withheld]" }],
        refused: [{ text: "[withheld]", rule: "shape" }],
        lastError: { says: { code: "c", message: "[withheld]" } },
      },
    });
  });
});
