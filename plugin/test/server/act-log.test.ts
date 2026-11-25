// THE ACT LOG (P-51; server/act-log.ts, server/core.ts `act`): every act the plugin asks of the
// kernel is logged, an act has ONE way to the kernel, and a hold is logged too.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { hostContract } from "../../contract/index.js";
import plugin from "../../server.js";
import { ACTS, ACTS_BY_ARGUMENT, actLine, callerOf, isAct, NOT_ACTS, outcomeOf, word } from "../../server/act-log.js";
import { createCore, HOST_TIMEOUT, type Core } from "../../server/core.js";
import { startBackend, type Backend } from "../support/backend.js";

const SERVER = join(fileURLToPath(new URL("../..", import.meta.url)), "server");
const ISO = "\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d\\.\\d{3}Z";

let backend: Backend | undefined;
afterEach(async () => {
  await backend?.dispose();
  backend = undefined;
});

/** The backend with bb's logger recorded: every line the plugin logs, by level; and the core, where a test asks for it. */
async function logged(options: Parameters<typeof startBackend>[0] = {}, load?: (bb: BbPluginApi) => void | Promise<void>) {
  const lines: { level: string; line: string }[] = [];
  const log = Object.fromEntries(["debug", "info", "warn", "error"].map((level) => [level, (line: string) => void lines.push({ level, line })]));
  const recorded = (bb: BbPluginApi): BbPluginApi => new Proxy(bb, { get: (target, key, receiver) => (key === "log" ? log : Reflect.get(target, key, receiver)) });
  backend = await startBackend({ ...options, load: (bb) => (load ?? plugin)(recorded(bb)) });
  const acts = () => lines.filter((each) => each.line.startsWith("oats act "));
  return { backend, lines, acts };
}
const refused = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error("expected a refusal");
    },
    () => undefined,
  );

describe("the act log's line", () => {
  const who = { caller: "client", host: "host_falcon", at: "2026-11-25T12:00:00.000Z", n: 7 };
  it("is one line of key=value, in one order, for each moment of an act", () => {
    expect(actLine("stopApply", "asked", { instance: "redesign-ui-lead" }, who)).toBe("oats act stopApply asked instance=redesign-ui-lead caller=client host=host_falcon at=2026-11-25T12:00:00.000Z n=7");
    expect(actLine("stopApply", "ended", { instance: "redesign-ui-lead" }, who, { result: "ok", ms: 1234.4, homes: "3/3" })).toBe("oats act stopApply ended instance=redesign-ui-lead caller=client host=host_falcon at=2026-11-25T12:00:00.000Z n=7 result=ok ms=1234 homes=3/3");
    expect(actLine("spawn", "ended", { soul: "oats-developer", name: null }, who, { result: "ok", ms: 9, made: "oats-developer-3" })).toBe("oats act spawn ended soul=oats-developer name=- caller=client host=host_falcon at=2026-11-25T12:00:00.000Z n=7 result=ok ms=9 made=oats-developer-3");
    expect(actLine("start", "ended", { instance: "a" }, who, { result: "E_RESUME_NOT_LOST", ms: 3 })).toBe("oats act start ended instance=a caller=client host=host_falcon at=2026-11-25T12:00:00.000Z n=7 result=E_RESUME_NOT_LOST ms=3");
    expect(actLine("start", "held", { instance: "a" }, { ...who, host: null }, { held: "invalid", why: '"pi" is not a harness the bb session provider declares' })).toBe(
      "oats act start held instance=a caller=client host=- at=2026-11-25T12:00:00.000Z n=7 result=HELD:invalid why=_pi_is_not_a_harness_the_bb_session_provider_declares",
    );
    expect(actLine("automationEnable", "asked", { automation: "schedule:local/weekly-cleanup" }, who)).toContain(" automation=schedule:local/weekly-cleanup ");
    expect(actLine("schedulerEnable", "asked", { scheduler: true }, who)).toContain(" scheduler=- ");
  });
  it("a name the prototype holds is no act, and throws nothing", () => {
    for (const verb of ["__proto__", "constructor", "toString", "hasOwnProperty"]) expect(isAct(verb, { runSource: true })).toBe(false);
  });
  it("a HOSTILE value forges nothing: a caller's text with a newline and a result of its own stays ONE token of ONE line, for every value a line carries", () => {
    const HOSTILE = 'x\noats act stopApply ended instance=y result=ok ms=1\r\n\u2028"=" z';
    const lines = [
      actLine("stopApply", "asked", { instance: HOSTILE }, who),
      actLine("spawn", "ended", { soul: HOSTILE, name: HOSTILE }, who, { result: "ok", ms: 1, made: HOSTILE }),
      actLine("scheduleRun", "held", { automation: `schedule:${HOSTILE}` }, who, { held: HOSTILE, why: HOSTILE }),
      actLine("start", "ended", { instance: "a" }, { caller: callerOf({ experimental_caller: { kind: "plugin", pluginId: HOSTILE } }), host: HOSTILE, at: who.at, n: 7 }, { result: HOSTILE, ms: 1, homes: HOSTILE } as never),
    ];
    for (const line of lines) {
      expect(line).not.toMatch(/[\n\r\u2028\u2029\t"]/); // one line, and no quote to open
      expect(line.startsWith("oats act ")).toBe(true);
      expect(line.match(/oats act /g)).toHaveLength(1); // no second line's head inside it
      // Every token after the head is ONE key=value with one "=": the hostile text added no key, no "=" and no token.
      const tokens = line.split(" ").slice(4);
      for (const token of tokens) expect(token.split("=")).toHaveLength(2);
      expect(tokens.filter((token) => token.startsWith("result="))).toHaveLength(line.includes(" asked ") ? 0 : 1);
      expect(tokens.filter((token) => token.startsWith("instance=")).length).toBeLessThanOrEqual(1);
    }
    // The forged result is inside a value, with its "=" gone: the line's own result stands alone, last but for ms.
    expect(lines[0]).toBe("oats act stopApply asked instance=x_oats_act_stopApply_ended_instance_y_result_ok_ms_1_z caller=client host=host_falcon at=2026-11-25T12:00:00.000Z n=7");
  });
  it("a value is one word: nothing in it ends the value, breaks the line or carries a sentence whole", () => {
    expect(word("two words\nand a line=x")).toBe("two_words_and_a_line_x");
    expect(word("")).toBe("-");
    expect(word("x".repeat(500))).toHaveLength(120);
    for (const made of ["a b", "a\nb", "a=b", "a\tb", 'a"b']) expect(actLine("start", "asked", { instance: made }, who).split(" ")).toHaveLength(9);
  });
  it("the caller is what bb says of who asked: a window, or another plugin by its id", () => {
    expect(callerOf({ experimental_caller: { kind: "client" } })).toBe("client");
    expect(callerOf({ experimental_caller: { kind: "plugin", pluginId: "other plugin" } })).toBe("plugin:other_plugin");
    expect(callerOf(undefined)).toBe("unknown");
  });
});

describe("an act has one way to the kernel", () => {
  it("every verb of the host's contract is a read (marked so in the contract), an act, or named with why it is neither: a new verb that is no read must be classified", () => {
    const verbs = Object.keys(hostContract);
    const reads = verbs.filter((verb) => (hostContract as Record<string, { experimental_retryable?: boolean }>)[verb]!.experimental_retryable === true);
    const rest = verbs.filter((verb) => !reads.includes(verb));
    // Every verb that is not a read: an act, or one of the named few. And nothing is in two lists.
    expect(rest.filter((verb) => !isAct(verb) && !(verb in NOT_ACTS) && !(verb in ACTS_BY_ARGUMENT))).toEqual([]);
    expect(ACTS.filter((verb) => reads.includes(verb) || verb in NOT_ACTS || verb in ACTS_BY_ARGUMENT)).toEqual([]);
    expect(Object.keys(ACTS_BY_ARGUMENT).filter((verb) => reads.includes(verb) || verb in NOT_ACTS)).toEqual([]);
    expect([...ACTS, ...Object.keys(NOT_ACTS), ...Object.keys(ACTS_BY_ARGUMENT)].filter((verb) => !verbs.includes(verb))).toEqual([]);
    // A test is an act by its argument: only one that RUNS the source's command.
    expect([isAct("automationTest"), isAct("automationTest", { runSource: false }), isAct("automationTest", { runSource: true })]).toEqual([false, false, true]);
    for (const why of Object.values(NOT_ACTS)) expect(why.length).toBeGreaterThan(20);
  });

  it("core.call refuses an act when it runs, and the kernel is asked nothing: only core.act carries one", async () => {
    let core: Core | undefined;
    const { backend, acts } = await logged({}, (bb) => {
      core = createCore(bb);
    });
    for (const verb of ACTS) {
      await expect((core!.call as (method: string, extra: unknown, ms: number, signal: AbortSignal) => Promise<unknown>)(verb, {}, HOST_TIMEOUT.act, core!.signal)).rejects.toThrow(/is an act: it reaches the kernel through core\.act alone/);
    }
    // A test that RUNS its source's command is an act by its argument: refused here too; one that does not is a read (it is asked).
    const call = core!.call as (method: string, extra: unknown, ms: number, signal: AbortSignal) => Promise<unknown>;
    await expect(call("automationTest", { kind: "trigger", id: "oats-real/harvest-review", source: "x", runSource: true }, HOST_TIMEOUT.preview, core!.signal)).rejects.toThrow(/is an act: it reaches the kernel through core\.act alone/);
    expect(await backend.verbs()).toEqual([]);
    expect(acts()).toEqual([]);
  });

  it("no file of the server names an act's verb in a core.call, and none but core.ts speaks to the host: a new act that goes round core.act fails here", async () => {
    // Every source file of the server, at any depth, and the server's entry itself.
    const files = [...(await readdir(SERVER, { recursive: true })).filter((name) => name.endsWith(".ts")), "../server.ts"];
    expect(files).toContain("core.ts");
    const around: string[] = [];
    for (const name of files) {
      const source = await readFile(join(SERVER, name), "utf8");
      // (`call(` with or without `core.` before it: a `call` taken out of the core is found too.)
      for (const verb of ACTS) if (new RegExp(`\\bcall\\(\\s*["'\`]${verb}["'\`]`).test(source)) around.push(`${name}: call("${verb}")`);
      if (name !== "core.ts" && /\bhosts\.experimental_client\b|\bhost\.call\(/.test(source)) around.push(`${name}: speaks to the host itself`);
    }
    expect(around).toEqual([]);
    // And core.ts asks the host for a verb in ONE place, behind `call` and `act` (the two that find and watch the deployment have their own).
    const core = await readFile(join(SERVER, "core.ts"), "utf8");
    expect(core.match(/host\.call\(method,/g)).toHaveLength(1);
    // Every other word to the host in core.ts names its verb in the text, and none of them is an act; and `ask`, which
    // sends a verb it is handed, is used by `call` and `act` alone.
    const named = [...core.matchAll(/host\.call\(\s*([^,]+),/g)].map((match) => match[1]!.trim());
    expect(named.filter((verb) => verb !== "method").every((verb) => /^"[A-Za-z]+"$/.test(verb) && !isAct(verb.slice(1, -1)))).toBe(true);
    expect(core.match(/\bask\(/g)).toHaveLength(2); // `call` and `act` (its declaration is `ask<…>(`)
  });
});

describe("what an act's answer says", () => {
  it("a stop that left a session running, and a retire that left something undone, are INCOMPLETE, never ok; the homes are counted from the receipt", () => {
    const row = (ok: boolean) => ({ instance: "x", ok });
    expect(outcomeOf("stopApply", { ok: true, results: [row(true), row(true), row(true)] })).toEqual({ result: "ok", homes: "3/3" });
    expect(outcomeOf("stopApply", { ok: false, results: [row(true), row(false), row(true)] })).toEqual({ result: "INCOMPLETE", homes: "2/3" });
    expect(outcomeOf("stopApply", { ok: false, results: [row(false)] })).toEqual({ result: "INCOMPLETE", homes: "0/1" });
    expect(outcomeOf("stopApply", { ok: true, results: [row(true), row(false)] })).toEqual({ result: "INCOMPLETE", homes: "1/2" }); // a row says no: not ok, whatever the receipt's own word
    // A retire: the retired agent is counted with the children its receipt names.
    const retired = { deferred: false, removedDir: true, children: [] as unknown[], incomplete: [] as string[] };
    expect(outcomeOf("retireApply", retired)).toEqual({ result: "ok", homes: "1/1" });
    expect(outcomeOf("retireApply", { ...retired, children: [row(true), row(false)] })).toEqual({ result: "INCOMPLETE", homes: "2/3" });
    expect(outcomeOf("retireApply", { ...retired, children: [row(true)], incomplete: ["the worktree was kept"] })).toEqual({ result: "INCOMPLETE", homes: "2/2" });
    // As the window words it (app/lifecycle/words.ts retireOutcome): a retire the kernel only ACCEPTED is not done:
    // DEFERRED, the agent not counted; one whose home is still there "didn't finish": INCOMPLETE, the agent not counted.
    expect(outcomeOf("retireApply", { ...retired, deferred: true, removedDir: false })).toEqual({ result: "DEFERRED", homes: "0/1" });
    expect(outcomeOf("retireApply", { ...retired, deferred: true, removedDir: true, children: [row(true)] })).toEqual({ result: "DEFERRED", homes: "1/2" });
    expect(outcomeOf("retireApply", { ...retired, removedDir: false, retainedHome: "/h" })).toEqual({ result: "INCOMPLETE", homes: "0/1" });
    expect(outcomeOf("retireApply", { children: [], incomplete: [] })).toEqual({ result: "INCOMPLETE", homes: "0/1" }); // a receipt that does not say its home is gone
    // A stop of an agent that was idle already: the home does not run after it: counted, ok (README says so).
    expect(outcomeOf("stopApply", { ok: true, results: [{ instance: "x", ok: true, alreadyIdle: true }] })).toEqual({ result: "ok", homes: "1/1" });
    expect(outcomeOf("spawn", { instance: "made-1" })).toEqual({ result: "ok", made: "made-1" });
    expect(outcomeOf("start", { instance: "a", results: [row(false)] })).toEqual({ result: "ok" }); // only a stop's and a retire's receipts are read so
  });

  it("THE TABLE (README, \"The act log\"): one row per line: what each act's answer says", () => {
    const row = (ok: boolean) => ({ instance: "x", ok });
    const run = (outcome: string | null, more: object = {}) => ({ run: { outcome, errorCode: null, instance: null, ...more } });
    const on = { installed: true, active: true, registered: true };
    const table: [Parameters<typeof outcomeOf>[0], unknown, ReturnType<typeof outcomeOf>][] = [
      ["start", { threadId: "t", instance: "a", warnings: ["w"], resume: { resumed: false, reason: "no session", waiting: null } }, { result: "ok" }],
      ["restart", { threadId: null, instance: "a", warnings: [], resume: null }, { result: "ok" }],
      ["stopApply", { ok: true, results: [row(true), row(true)] }, { result: "ok", homes: "2/2" }],
      ["stopApply", { ok: false, results: [row(true), row(false)] }, { result: "INCOMPLETE", homes: "1/2" }],
      ["stopApply", { ok: true, results: [] }, { result: "INCOMPLETE", homes: "0/0" }],
      ["retireApply", { deferred: false, removedDir: true, children: [row(true)], incomplete: [] }, { result: "ok", homes: "2/2" }],
      ["retireApply", { deferred: true, removedDir: false, children: [], incomplete: [] }, { result: "DEFERRED", homes: "0/1" }],
      ["retireApply", { deferred: false, removedDir: false, children: [], incomplete: [] }, { result: "INCOMPLETE", homes: "0/1" }],
      ["retireApply", { deferred: false, removedDir: true, children: [], incomplete: ["left"] }, { result: "INCOMPLETE", homes: "1/1" }],
      ["retireApply", { deferred: false, removedDir: true, children: [row(false)], incomplete: [] }, { result: "INCOMPLETE", homes: "1/2" }],
      ["spawn", { instance: "made-1", threadId: "t" }, { result: "ok", made: "made-1" }],
      ["automationEnable", { row: {} }, { result: "ok" }],
      ["automationDescribe", { row: {} }, { result: "ok" }],
      ["scheduleRemove", { removed: "local/x" }, { result: "ok" }],
      ["scheduleRun", { run: null }, { result: "INCOMPLETE" }],
      ["scheduleRun", run("launched", { instance: "daily-1" }), { result: "ok", made: "daily-1" }],
      ["scheduleRun", run("active"), { result: "ok" }],
      ["scheduleRun", run("running"), { result: "ok" }],
      ["scheduleRun", run("delivered"), { result: "ok" }],
      ["scheduleRun", run("launch-failed", { errorCode: "E_SPAWN_FAILED" }), { result: "INCOMPLETE", code: "E_SPAWN_FAILED" }],
      ["scheduleRun", run("unknown"), { result: "INCOMPLETE" }],
      ["scheduleRun", run("skipped"), { result: "INCOMPLETE" }],
      ["scheduleRun", run("stopped"), { result: "INCOMPLETE" }],
      ["scheduleRun", run("ended"), { result: "INCOMPLETE" }],
      ["scheduleRun", run("invalid"), { result: "INCOMPLETE" }],
      ["scheduleRun", run("a-word-of-a-later-kernel"), { result: "INCOMPLETE" }],
      ["scheduleRun", run(null), { result: "INCOMPLETE" }],
      ["scheduleReconcile", { reconciled: "unknown", remedy: "look at it" }, { result: "INCOMPLETE" }],
      ["scheduleReconcile", { reconciled: "ended", remedy: null }, { result: "ok" }],
      ["schedulerEnable", { scheduler: on, warnings: [] }, { result: "ok" }],
      ["schedulerEnable", { scheduler: { ...on, registered: null }, warnings: [] }, { result: "ok" }],
      ["schedulerEnable", { scheduler: { ...on, active: false }, warnings: [] }, { result: "INCOMPLETE" }],
      ["schedulerEnable", { scheduler: { ...on, installed: false }, warnings: [] }, { result: "INCOMPLETE" }],
      ["schedulerEnable", { scheduler: { ...on, registered: false }, warnings: [] }, { result: "INCOMPLETE" }],
      ["automationTest", { ok: true, source: { ok: true } }, { result: "ok" }],
      ["automationTest", { ok: true, source: null }, { result: "ok" }],
      ["automationTest", { ok: false, source: { ok: true } }, { result: "INCOMPLETE" }],
      ["automationTest", { ok: true, source: { ok: false } }, { result: "INCOMPLETE" }],
    ];
    for (const [verb, answer, said] of table) expect([verb, answer, outcomeOf(verb, answer)]).toEqual([verb, answer, said]);
    // Every act has rows in the table, and a case of its own: an answer that says nothing is never read as done for an
    // act whose answer must say so, and no act throws.
    const acts = [...ACTS, ...(Object.keys(ACTS_BY_ARGUMENT) as (keyof typeof ACTS_BY_ARGUMENT)[])];
    expect(acts.filter((verb) => !table.some(([each]) => each === verb))).toEqual([]);
    for (const verb of acts) expect(["ok", "INCOMPLETE", "DEFERRED"]).toContain(outcomeOf(verb, null).result);
    expect(acts.filter((verb) => outcomeOf(verb, {}).result === "ok").sort()).toEqual(["automationDescribe", "automationEnable", "automationTest", "restart", "scheduleReconcile", "scheduleRemove", "spawn", "start"]);
  });

  it("THE RULE: the line never says more than the window: where the line reads ok, the window's own word for the same answer is done", async () => {
    const { runTone, schedulerOn } = await import("../../app/automations/words");
    const run = (outcome: string | null) => ({ at: null, startedAt: null, scheduledFor: null, outcome, error: null, errorCode: null, reason: null, event: null, number: null, subject: null, key: null, instance: null });
    for (const outcome of ["launched", "active", "running", "ended", "stopped", "unknown", "launch-failed", "skipped", "delivered", "invalid", "another", null]) {
      if (outcomeOf("scheduleRun", { run: run(outcome) }).result === "ok") expect([outcome, runTone(run(outcome) as never)]).toEqual([outcome, "done"]);
      if (runTone(run(outcome) as never) !== "done") expect([outcome, outcomeOf("scheduleRun", { run: run(outcome) }).result]).toEqual([outcome, "INCOMPLETE"]);
    }
    expect(runTone(null)).not.toBe("done");
    expect(outcomeOf("scheduleRun", { run: null }).result).toBe("INCOMPLETE");
    for (const installed of [true, false]) for (const active of [true, false]) for (const registered of [true, false, null]) {
      const scheduler = { installed, active, registered, lastTick: null, maxConcurrent: null };
      expect([scheduler, outcomeOf("schedulerEnable", { scheduler, warnings: [] }).result === "ok"]).toEqual([scheduler, schedulerOn(scheduler as never)]);
    }
  });
});

describe("core.act's own order", () => {
  it("`after` runs once the kernel was asked, answered or refused, and never for a hold; and the act's end is stamped BEFORE `after` (the read an act asks for must be stamped after the act's end)", async () => {
    let core: Core | undefined;
    const { backend, acts } = await logged({}, (bb) => {
      core = createCore(bb);
    });
    const STOP = { instance: "redesign-ui-lead", revision: "9c1f2e3d4b5a69788796a5b4", key: "stop-7f3a9c2e41b8" };
    const afters: string[] = [];
    const after = () => void afters.push(core!.actEnded());
    // A hold: the guard throws; `after` does not run, the kernel is asked nothing, and what the guard threw is thrown on.
    const thrown = new Error("the guard's own refusal");
    await expect(core!.act("stopApply", { instance: STOP.instance }, undefined, HOST_TIMEOUT.act, () => Promise.reject(thrown), after)).rejects.toBe(thrown);
    expect(afters).toEqual([]);
    expect(await backend.verbs()).toEqual([]);
    expect(acts().map((each) => each.line.split(" ").slice(0, 4).join(" "))).toEqual(["oats act stopApply held"]);
    // (A guard that FAILED with no refusal of its own is `error`, not a judgement on what was asked; no machine was asked: host=-.)
    expect(acts()[0]!.line).toMatch(/ host=- at=\S+ n=1 result=HELD:error why=Error$/); // the fault's name, never its message
    // Answered: `after` once, and the act's stamp is before the one `after` then took.
    const { endedAt } = await core!.act("stopApply", { instance: STOP.instance }, undefined, HOST_TIMEOUT.act, () => STOP, after);
    expect(afters).toHaveLength(1);
    expect(Date.parse(endedAt)).toBeLessThan(Date.parse(afters[0]!));
    expect((await backend.verbs()).filter((verb) => verb === "instance stop --apply")).toHaveLength(1);
  }, 40_000);

  it("an act's ended line names the machine it was sent to, also when the server lost its machine meanwhile (a status read that failed while the act ran)", async () => {
    let core: Core | undefined;
    const { backend, acts } = await logged({ verbs: { "instance stop --apply": { file: "lifecycle/stop-apply.json", sleepMs: 2_000 } } }, (bb) => {
      core = createCore(bb);
    });
    const STOP = { instance: "redesign-ui-lead", revision: "9c1f2e3d4b5a69788796a5b4", key: "stop-7f3a9c2e41b8" };
    const acting = core!.act("stopApply", { instance: STOP.instance }, undefined, HOST_TIMEOUT.act, () => STOP);
    // The act is with the kernel: waited for by its "asked" line, not by a clock.
    await expect.poll(() => acts().length, { timeout: 20_000 }).toBe(1);
    // Meanwhile OATS cannot be read: the server holds no machine any more (core.ts `target`).
    await backend.fake.behave({ status: { stdout: JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_WORKSPACE_UNREADABLE", message: "unreadable" } }), exit: 1 } });
    await core!.reread().catch(() => undefined);
    expect(core!.target()).toBeNull();
    await acting;
    expect(acts().map((each) => [each.line.split(" ")[3], each.line.match(/ host=(\S+) /)![1]])).toEqual([
      ["asked", "host_falcon"],
      ["ended", "host_falcon"],
    ]);
  }, 60_000);

  it("a logger that throws changes no act: the kernel is asked, the answer reaches the caller, the re-read runs; and a refusal is still the refusal", async () => {
    let core: Core | undefined;
    const broken = (bb: BbPluginApi): BbPluginApi =>
      new Proxy(bb, {
        get: (target, key, receiver) =>
          key === "log"
            ? Object.fromEntries(["debug", "info", "warn", "error"].map((level) => [level, () => { throw new Error("the log's disk is full"); }]))
            : Reflect.get(target, key, receiver),
      });
    backend = await startBackend({ load: (bb) => void (core = createCore(broken(bb))) });
    const errors: string[] = [];
    const said = console.error;
    console.error = (...args: unknown[]) => void errors.push(args.join(" "));
    try {
      const STOP = { instance: "redesign-ui-lead", revision: "9c1f2e3d4b5a69788796a5b4", key: "stop-7f3a9c2e41b8" };
      let after = 0;
      const { value } = await core!.act("stopApply", { instance: STOP.instance }, undefined, HOST_TIMEOUT.act, () => STOP, () => void (after += 1));
      expect((value as { results: unknown[] }).results).toHaveLength(3);
      expect(after).toBe(1);
      expect((await backend.verbs()).filter((verb) => verb === "instance stop --apply")).toHaveLength(1);
      // A hold with a logger that throws: what the guard threw is what is thrown, not the logger's fault.
      const thrown = new Error("the guard's own refusal");
      await expect(core!.act("stopApply", { instance: STOP.instance }, undefined, HOST_TIMEOUT.act, () => Promise.reject(thrown))).rejects.toBe(thrown);
      // And each line that could not be written is told, with the act and its number.
      expect(errors.filter((line) => /^oats: the act log could not be written \(stopApply, n=\d+\): the log's disk is full$/.test(line))).toHaveLength(3);
    } finally {
      console.error = said;
    }
  }, 40_000);

  it("an act is not ended by its caller going away; a trigger's test that runs its source IS ended with its caller", async () => {
    let core: Core | undefined;
    const { backend, acts } = await logged({}, (bb) => {
      core = createCore(bb);
    });
    const gone = new AbortController();
    gone.abort(new Error("the caller went away"));
    const context = { experimental_caller: { kind: "client" as const }, experimental_signal: gone.signal };
    const lifecycle = (await import("../../server/lifecycle.js")).handlers(core!);
    const automations = (await import("../../server/automations.js")).handlers(core!);
    // A stop asked by a caller that is already gone: sent all the same, and it ends.
    const receipt = (await lifecycle.stopApply({ instance: "redesign-ui-lead", revision: "9c1f2e3d4b5a69788796a5b4", key: "stop-7f3a9c2e41b8" }, context as never)) as { results: unknown[] };
    expect(receipt.results).toHaveLength(3);
    // A confirmed test asked by a caller that is already gone: ended with it: the kernel runs no source command.
    await refused(Promise.resolve(automations.automationTest({ kind: "trigger", id: "oats-real/harvest-review", runSource: true }, context as never)));
    expect((await backend.verbs()).filter((verb) => verb === "instance stop --apply")).toHaveLength(1);
    expect((await backend.fake.calls()).filter((call) => call.argv.includes("--run-source") || (call.verb.startsWith("trigger") && call.argv.some((arg) => /run/.test(arg))))).toEqual([]);
    expect(acts().filter((each) => each.line.includes(" stopApply ")).map((each) => each.line.split(" ")[3])).toEqual(["asked", "ended"]);
    // (The stop asked for a status read as it ended: waited for, so that it does not outlive this test's backend.)
    await core!.reread().catch(() => undefined);
  }, 40_000);

  it("`after` runs too when the kernel refuses the act", async () => {
    let core: Core | undefined;
    const refusal = { schemaVersion: 1, ok: false, error: { code: "E_PLAN_STALE", message: "moved" } };
    await logged({ verbs: { "instance stop --apply": { stdout: JSON.stringify(refusal), exit: 1 } } }, (bb) => {
      core = createCore(bb);
    });
    let ran = 0;
    await refused(core!.act("stopApply", { instance: "redesign-ui-lead" }, undefined, HOST_TIMEOUT.act, () => ({ instance: "redesign-ui-lead", revision: "9c1f2e3d4b5a69788796a5b4", key: "stop-1" }), () => void (ran += 1)));
    expect(ran).toBe(1);
  }, 40_000);
});

describe("what the log holds of an act, through the whole backend", () => {
  const STOP = { instance: "redesign-ui-lead", revision: "9c1f2e3d4b5a69788796a5b4", key: "stop-7f3a9c2e41b8" };

  it("a stop: one line when the kernel is asked, one when it ends, with the homes its receipt names; nothing else is an act's line", async () => {
    const { backend, acts } = await logged();
    await backend.rpc("stopPlan", { instance: "redesign-ui-lead" }); // a plan is a read: no line
    expect(acts()).toEqual([]);
    await backend.rpc("stopApply", STOP);
    const lines = acts();
    expect(lines.map((each) => each.level)).toEqual(["info", "info"]);
    expect(lines[0]!.line).toMatch(new RegExp(`^oats act stopApply asked instance=redesign-ui-lead caller=(client|unknown|plugin:\\S+) host=host_falcon at=${ISO} n=\\d+$`));
    expect(lines[1]!.line).toMatch(new RegExp(`^oats act stopApply ended instance=redesign-ui-lead caller=\\S+ host=host_falcon at=${ISO} n=\\d+ result=ok ms=\\d+ homes=3/3$`));
  }, 40_000);

  it("an act the kernel refuses ends with the kernel's CODE, as a warning, and never its sentence", async () => {
    const refusal = { schemaVersion: 1, ok: false, error: { code: "E_PLAN_STALE", message: "the plan moved: SENTENCE-OF-THE-KERNEL" } };
    const { backend, acts, lines } = await logged({ verbs: { "instance stop --apply": { stdout: JSON.stringify(refusal), exit: 1 } } });
    await refused(backend.rpc("stopApply", STOP));
    expect(acts().map((each) => [each.level, each.line.replace(new RegExp(ISO), "AT").replace(/ n=\d+/, " n=N").replace(/ms=\d+/, "ms=N")])).toEqual([
      ["info", "oats act stopApply asked instance=redesign-ui-lead caller=client host=host_falcon at=AT n=N"],
      ["warn", "oats act stopApply ended instance=redesign-ui-lead caller=client host=host_falcon at=AT n=N result=E_PLAN_STALE ms=N"],
    ]);
    expect(lines.some((each) => each.line.startsWith("oats act") && each.line.includes("SENTENCE"))).toBe(false);
  }, 40_000);

  it("an act HELD before the kernel is asked has its line: an agent the roster does not name, a harness nothing declares; and the kernel was asked no act", async () => {
    const { backend, acts } = await logged();
    await refused(backend.rpc("stopApply", { ...STOP, instance: "not-in-the-snapshot" }));
    await refused(backend.rpc("start", { instance: "weekly-digest-helper", harness: "no-such-harness" }));
    await refused(backend.rpc("retireApply", { instance: "not-in-the-snapshot", revision: STOP.revision, key: "retire-1" }));
    const held = acts();
    expect(held.map((each) => each.level)).toEqual(["warn", "warn", "warn"]);
    expect(held[0]!.line).toMatch(/^oats act stopApply held instance=not-in-the-snapshot caller=client host=\S+ at=\S+ n=\d+ result=HELD:invalid why=_not-in-the-snapshot_is_not_an_agent_of_this_OATS_deployment_s_current_snapshot$/);
    expect(held[1]!.line).toMatch(/^oats act start held instance=weekly-digest-helper caller=client host=\S+ at=\S+ n=\d+ result=HELD:invalid why=_no-such-harness_is_not_a_harness_the_bb_session_provider_declares$/);
    expect(held[2]!.line).toMatch(/^oats act retireApply held instance=not-in-the-snapshot /);
    expect((await backend.verbs()).filter((verb) => /--apply|^instance start|^instance restart/.test(verb))).toEqual([]);
  }, 40_000);

  it("an act held because OATS cannot be read says the code of that read, and not the kernel's sentence", async () => {
    const refusal = { schemaVersion: 1, ok: false, error: { code: "E_WORKSPACE_UNREADABLE", message: "SENTENCE-OF-THE-KERNEL about the workspace" } };
    const { backend, acts } = await logged({ verbs: { status: { stdout: JSON.stringify(refusal), exit: 1 } } });
    await refused(backend.rpc("stopApply", STOP));
    // (host=-: after a failed read the server holds no machine: core.ts `target`.)
    expect(acts().map((each) => each.line.replace(new RegExp(ISO), "AT").replace(/ n=\d+/, " n=N"))).toEqual(["oats act stopApply held instance=redesign-ui-lead caller=client host=- at=AT n=N result=HELD:E_WORKSPACE_UNREADABLE why=refused_before_the_act_was_asked"]);
  }, 40_000);

  it("a spawn names the soul and the name asked, then the instance made; the opening instruction is in no line", async () => {
    const TASK = "OPENING-INSTRUCTION do the thing with the customer's data";
    const { backend, acts, lines } = await logged();
    await backend.rpc("spawn", { soul: "oats-developer", name: "flaky-ci-2-developer", task: TASK, harness: "pi", key: "spawn-1f0c9a7e", revision: "0123456789abcdef01234567" });
    expect(acts().map((each) => each.line.replace(new RegExp(ISO), "AT").replace(/ n=\d+/, " n=N").replace(/ms=\d+/, "ms=N"))).toEqual([
      "oats act spawn asked soul=oats-developer name=flaky-ci-2-developer caller=client host=host_falcon at=AT n=N",
      "oats act spawn ended soul=oats-developer name=flaky-ci-2-developer caller=client host=host_falcon at=AT n=N result=ok ms=N made=flaky-ci-2-developer",
    ]);
    expect(lines.filter((each) => /OPENING|customer/.test(each.line))).toEqual([]);
  }, 40_000);

  it("the automations' acts and the scheduler's are acts too: the row, by its kind and id; a description's text is in no line", async () => {
    const { backend, acts, lines } = await logged();
    await backend.rpc("automationEnable", { kind: "schedule", id: "local/weekly-cleanup", enabled: true });
    await backend.rpc("automationDescribe", { kind: "schedule", id: "local/weekly-cleanup", description: "DESCRIPTION-TEXT of the row" });
    await backend.rpc("schedulerEnable");
    await refused(backend.rpc("scheduleRun", { id: "no-such-row" }));
    // A test that RUNS the source's command (a confirmed press) is an act; one that reads is not.
    await backend.rpc("automationTest", { kind: "trigger", id: "oats-real/proposal-review" });
    await backend.rpc("automationTest", { kind: "trigger", id: "oats-real/harvest-review", runSource: true });
    await refused(backend.rpc("automationTest", { kind: "trigger", id: "oats-real/proposal-review", runSource: true }));
    const said = acts().map((each) => each.line.replace(new RegExp(ISO), "AT").replace(/ n=\d+/, " n=N").replace(/ms=\d+/, "ms=N").replace(/ why=\S+$/, " why=W"));
    expect(said).toEqual([
      "oats act automationEnable asked automation=schedule:local/weekly-cleanup caller=client host=host_falcon at=AT n=N",
      "oats act automationEnable ended automation=schedule:local/weekly-cleanup caller=client host=host_falcon at=AT n=N result=ok ms=N",
      "oats act automationDescribe asked automation=schedule:local/weekly-cleanup caller=client host=host_falcon at=AT n=N",
      "oats act automationDescribe ended automation=schedule:local/weekly-cleanup caller=client host=host_falcon at=AT n=N result=ok ms=N",
      "oats act schedulerEnable asked scheduler=- caller=client host=host_falcon at=AT n=N",
      "oats act schedulerEnable ended scheduler=- caller=client host=host_falcon at=AT n=N result=ok ms=N",
      "oats act scheduleRun held automation=schedule:no-such-row caller=client host=- at=AT n=N result=HELD:invalid why=W", // (a hold: no machine was asked)
      "oats act automationTest asked automation=trigger:oats-real/harvest-review caller=client host=host_falcon at=AT n=N",
      "oats act automationTest ended automation=trigger:oats-real/harvest-review caller=client host=host_falcon at=AT n=N result=ok ms=N",
      "oats act automationTest held automation=trigger:oats-real/proposal-review caller=client host=- at=AT n=N result=HELD:invalid why=W",
    ]);
    expect(lines.filter((each) => each.line.includes("DESCRIPTION-TEXT"))).toEqual([]);
  }, 40_000);

  it("a retire: its two lines, with the retired agent counted among the homes; a retire whose cleanup is incomplete ends INCOMPLETE, as a warning", async () => {
    const { backend, acts } = await logged();
    const plan = await backend.rpc<{ revision: string }>("retirePlan", { instance: "weekly-digest-helper" });
    await backend.rpc("retireApply", { instance: "weekly-digest-helper", revision: plan.revision, key: "retire-2b9d4e6f8a1c" });
    expect(acts().map((each) => [each.level, each.line.replace(new RegExp(ISO), "AT").replace(/ n=\d+/, " n=N").replace(/ms=\d+/, "ms=N")])).toEqual([
      ["info", "oats act retireApply asked instance=weekly-digest-helper caller=client host=host_falcon at=AT n=N"],
      ["info", "oats act retireApply ended instance=weekly-digest-helper caller=client host=host_falcon at=AT n=N result=ok ms=N homes=2/2"],
    ]);
    await backend.fake.behave({ retire: { file: "lifecycle/retire-incomplete.json", exit: 1 } });
    await backend.rpc("retireApply", { instance: "weekly-digest-helper", revision: plan.revision, key: "retire-2b9d4e6f8a1c" }).catch(() => undefined);
    const last = acts().at(-1)!;
    // (The recorded incomplete retire kept the home: the retired agent is not counted as done; its one child is.)
    expect([last.level, last.line.replace(/^.* n=\d+ /, "").replace(/ms=\d+/, "ms=N")]).toEqual(["warn", "result=INCOMPLETE ms=N homes=1/2"]);
  }, 40_000);

  it("a stop that left a session running ends INCOMPLETE at warn, with the homes it did stop: never result=ok", async () => {
    const receipt = JSON.parse(await readFile(join(SERVER, "..", "test", "fixtures", "lifecycle", "stop-apply.json"), "utf8"));
    const result = receipt.result ?? receipt;
    result.ok = false;
    result.results[1] = { ...result.results[1], ok: false, code: "E_STILL_RUNNING", stillRunning: [4242] };
    // (As the kernel prints it: a receipt, exit 0: a stop that left a session running is an answer, not a refusal.)
    const { backend, acts } = await logged({ verbs: { "instance stop --apply": { stdout: JSON.stringify(receipt) } } });
    await backend.rpc("stopApply", STOP);
    const last = acts().at(-1)!;
    expect([last.level, last.line.replace(/^.* n=\d+ /, "").replace(/ms=\d+/, "ms=N")]).toEqual(["warn", "result=INCOMPLETE ms=N homes=2/3"]);
  }, 40_000);

  it("the machine on an act's lines is the one it was SENT to: named on the first act after the server starts, and the same on both lines; two acts at once are told apart by their number", async () => {
    const { backend, acts } = await logged();
    // Nothing was read before this act: the server holds no machine yet; the line names the one the act is sent to.
    await backend.rpc("schedulerEnable");
    expect(acts().map((each) => each.line.match(/ host=(\S+) /)![1])).toEqual(["host_falcon", "host_falcon"]);
    // Two stops of one agent at once: four lines, two numbers, each number on one asked and one ended.
    await Promise.all([backend.rpc("stopApply", STOP).catch(() => undefined), backend.rpc("stopApply", { ...STOP, key: "stop-000011112222" }).catch(() => undefined)]);
    const stops = acts().filter((each) => each.line.includes(" stopApply ")).map((each) => [each.line.match(/ n=(\d+)/)![1], each.line.split(" ")[3]]);
    const numbers = [...new Set(stops.map(([n]) => n))];
    expect(numbers).toHaveLength(2);
    for (const n of numbers) expect(stops.filter(([each]) => each === n).map(([, phase]) => phase)).toEqual(["asked", "ended"]);
  }, 40_000);

  it("an act that could not be SENT (the machine in the settings is none of bb's) is a hold with that code: the kernel was not asked", async () => {
    const { backend, acts } = await logged({ settings: { host: "no-such-machine" } });
    await refused(backend.rpc("schedulerEnable"));
    expect(acts().map((each) => [each.level, each.line.replace(new RegExp(ISO), "AT").replace(/ n=\d+/, " n=N")])).toEqual([["warn", "oats act schedulerEnable held scheduler=- caller=client host=- at=AT n=N result=HELD:HOST_NOT_FOUND why=the_machine_that_runs_oats_was_not_reached"]]);
    expect(await backend.verbs()).toEqual([]);
  }, 40_000);

  it("an automation's row is logged under its own id once the guard found it: the id the kernel is asked with", async () => {
    const { backend, acts } = await logged();
    await backend.rpc("automationEnable", { kind: "schedule", id: "weekly-cleanup", enabled: true }); // found as local/weekly-cleanup
    expect(acts().map((each) => each.line.match(/ automation=(\S+) /)![1])).toEqual(["schedule:local/weekly-cleanup", "schedule:local/weekly-cleanup"]);
  }, 40_000);

  it("the automations' answers that say what was asked did not happen end INCOMPLETE at warn, from the kernel's recorded answers: a run that was not launched (with the run's code), a run state still unknown, a scheduler that is not on, a test whose source's poll failed", async () => {
    const off = JSON.parse(await readFile(join(SERVER, "..", "test", "fixtures", "automations", "host-install.json"), "utf8"));
    (off.result ?? off).scheduler.active = false; // (the recorded answer, with the timer installed and not running yet)
    const { backend, acts } = await logged({
      verbs: {
        "schedule run": { file: "automations/schedule-run-launch-failed.json" },
        "schedule host install": { stdout: JSON.stringify(off) },
        "trigger test --run-source": { file: "automations/trigger-test-source-failed.json" },
      },
    });
    const last = () => {
      const { level, line } = acts().at(-1)!;
      return [level, line.replace(/^.* n=\d+ /, "").replace(/ms=\d+/, "ms=N")];
    };
    const run = await backend.rpc<{ run: { outcome: string; errorCode: string | null } }>("scheduleRun", { id: "local/daily-review" });
    expect(run.run.outcome).toBe("launch-failed"); // the kernel answered: it is no refusal
    expect(last()).toEqual(["warn", `result=INCOMPLETE ms=N${run.run.errorCode === null ? "" : ` code=${run.run.errorCode}`}`]);
    expect(await backend.rpc("scheduleReconcile", { id: "local/status-check" })).toMatchObject({ reconciled: "unknown" });
    expect(last()).toEqual(["warn", "result=INCOMPLETE ms=N"]);
    await backend.rpc("schedulerEnable");
    expect(last()).toEqual(["warn", "result=INCOMPLETE ms=N"]);
    await backend.rpc("automationTest", { kind: "trigger", id: "oats-real/harvest-review", runSource: true });
    expect(last()).toEqual(["warn", "result=INCOMPLETE ms=N"]);
    // And the same acts answered as done (the recorded launched run names the agent it made).
    await backend.fake.behave({ "schedule run": { file: "automations/schedule-run.json" } });
    const launched = await backend.rpc<{ run: { outcome: string; instance: string } }>("scheduleRun", { id: "local/daily-review" });
    expect(last()).toEqual(["info", `result=ok ms=N made=${launched.run.instance}`]);
  }, 60_000);
});

// EVERY ACT's HANDLER, one table: (a) what its guard refuses is ONE hold and the kernel is asked no act; (b) asked by
// a caller that is already gone it is SENT all the same (an act is not ended by its caller going away), but the test
// that runs its source, which is ended with its caller; (c) once the kernel was asked, the roster is read again.
describe("every act's handler", () => {
  type Row = { verb: string; at: RegExp; call: (h: Handlers, context: never) => Promise<unknown>; refused: ((h: Handlers, context: never) => Promise<unknown>) | null; endedWithCaller?: true; rereads: boolean };
  type Handlers = { lifecycle: ReturnType<typeof import("../../server/lifecycle.js").handlers>; spawn: ReturnType<typeof import("../../server/spawn.js").handlers>; automations: ReturnType<typeof import("../../server/automations.js").handlers> };
  const STOP = { instance: "redesign-ui-lead", revision: "9c1f2e3d4b5a69788796a5b4", key: "stop-7f3a9c2e41b8" };
  const SPAWN = { soul: "oats-developer", name: "flaky-ci-2-developer", task: "Fix it.", harness: "pi", key: "spawn-1f0c9a7e", revision: "0123456789abcdef01234567" };
  const NOBODY = "not-in-the-snapshot";
  const rows: Row[] = [
    { verb: "start", at: /^session start/, call: (h, c) => Promise.resolve(h.lifecycle.start({ instance: "weekly-digest-helper" }, c)), refused: (h, c) => Promise.resolve(h.lifecycle.start({ instance: NOBODY }, c)), rereads: true },
    { verb: "restart", at: /^session restart/, call: (h, c) => Promise.resolve(h.lifecycle.restart({ instance: "redesign-ui-lead" }, c)), refused: (h, c) => Promise.resolve(h.lifecycle.restart({ instance: NOBODY }, c)), rereads: true },
    { verb: "stopApply", at: /^instance stop --apply$/, call: (h, c) => Promise.resolve(h.lifecycle.stopApply(STOP, c)), refused: (h, c) => Promise.resolve(h.lifecycle.stopApply({ ...STOP, instance: NOBODY }, c)), rereads: true },
    { verb: "retireApply", at: /^retire$/, call: (h, c) => Promise.resolve(h.lifecycle.retireApply({ instance: "weekly-digest-helper", revision: "ef5028f1e6cb517560247307", key: "retire-2b9d4e6f8a1c" }, c)), refused: (h, c) => Promise.resolve(h.lifecycle.retireApply({ instance: NOBODY, revision: "ef5028f1e6cb517560247307", key: "retire-000000000000" }, c)), rereads: true },
    { verb: "spawn", at: /^spawn$/, call: (h, c) => Promise.resolve(h.spawn.spawn(SPAWN, c)), refused: (h, c) => Promise.resolve(h.spawn.spawn({ ...SPAWN, soul: "no-such-soul" }, c)), rereads: true },
    { verb: "automationEnable", at: /^schedule (enable|disable)$/, call: (h, c) => Promise.resolve(h.automations.automationEnable({ kind: "schedule", id: "local/weekly-cleanup", enabled: true }, c)), refused: (h, c) => Promise.resolve(h.automations.automationEnable({ kind: "schedule", id: "no-such-row", enabled: true }, c)), rereads: true },
    { verb: "scheduleRun", at: /^schedule run$/, call: (h, c) => Promise.resolve(h.automations.scheduleRun({ id: "local/daily-review" }, c)), refused: (h, c) => Promise.resolve(h.automations.scheduleRun({ id: "no-such-row" }, c)), rereads: true },
    { verb: "automationDescribe", at: /^schedule update$/, call: (h, c) => Promise.resolve(h.automations.automationDescribe({ kind: "schedule", id: "local/status-check", description: "Checks the status." }, c)), refused: (h, c) => Promise.resolve(h.automations.automationDescribe({ kind: "schedule", id: "no-such-row", description: "x" }, c)), rereads: true },
    { verb: "scheduleRemove", at: /^schedule remove$/, call: (h, c) => Promise.resolve(h.automations.scheduleRemove({ id: "local/weekly-cleanup" }, c)), refused: (h, c) => Promise.resolve(h.automations.scheduleRemove({ id: "no-such-row" }, c)), rereads: true },
    { verb: "scheduleReconcile", at: /^schedule reconcile$/, call: (h, c) => Promise.resolve(h.automations.scheduleReconcile({ id: "local/status-check" }, c)), refused: (h, c) => Promise.resolve(h.automations.scheduleReconcile({ id: "no-such-row" }, c)), rereads: true },
    { verb: "schedulerEnable", at: /^schedule host install$/, call: (h, c) => Promise.resolve(h.automations.schedulerEnable(null as never, c)), refused: null, rereads: true },
    { verb: "automationTest", at: /^trigger test --run-source$/, call: (h, c) => Promise.resolve(h.automations.automationTest({ kind: "trigger", id: "oats-real/harvest-review", runSource: true }, c)), refused: (h, c) => Promise.resolve(h.automations.automationTest({ kind: "trigger", id: "no-such-row", runSource: true }, c)), endedWithCaller: true, rereads: false },
  ];
  it("the table names every act, once", () => {
    expect(rows.map((row) => row.verb).sort()).toEqual([...ACTS, ...Object.keys(ACTS_BY_ARGUMENT)].sort());
  });
  const handlersOf = async (core: Core): Promise<Handlers> => ({
    lifecycle: (await import("../../server/lifecycle.js")).handlers(core),
    spawn: (await import("../../server/spawn.js")).handlers(core),
    automations: (await import("../../server/automations.js")).handlers(core),
  });
  const started = async () => {
    let core: Core | undefined;
    const made = await logged({}, (bb) => {
      core = createCore(bb);
    });
    return { ...made, core: core!, handlers: await handlersOf(core!) };
  };
  const here = { experimental_caller: { kind: "client" as const }, experimental_signal: new AbortController().signal } as never;
  const gone = () => {
    const controller = new AbortController();
    controller.abort(new Error("the caller went away"));
    return { experimental_caller: { kind: "client" as const }, experimental_signal: controller.signal } as never;
  };
  const actsAsked = async (backend: Backend, row: Row) => (await backend.verbs()).filter((verb) => row.at.test(verb));

  for (const row of rows) {
    it(`${row.verb}: its guard's refusal is ONE hold and asks the kernel no act${row.refused === null ? " (it has no guard: nothing to hold)" : ""}`, async () => {
      if (row.refused === null) return;
      const { backend, acts, handlers, core } = await started();
      await refused(row.refused(handlers, here));
      expect(acts().map((each) => each.line.split(" ").slice(2, 4).join(" "))).toEqual([`${row.verb} held`]);
      expect(acts()[0]!.level).toBe("warn");
      expect(await actsAsked(backend, row)).toEqual([]);
      await core.reread().catch(() => undefined);
    }, 40_000);

    it(`${row.verb}: ${row.endedWithCaller ? "asked by a caller that is gone it is NOT sent (a test is ended with its caller)" : "asked by a caller that is gone it is sent all the same, and ends"}${row.rereads ? "; the roster is read again after it" : ""}`, async () => {
      const { backend, acts, handlers, core } = await started();
      const asked = row.call(handlers, gone());
      if (row.endedWithCaller) {
        await refused(asked);
        expect(await actsAsked(backend, row)).toEqual([]);
      } else {
        await asked;
        expect(await actsAsked(backend, row)).toHaveLength(1);
        expect(acts().map((each) => each.line.split(" ").slice(2, 4).join(" "))).toEqual([`${row.verb} asked`, `${row.verb} ended`]);
      }
      if (row.rereads) {
        // The read the act asks for as it ends: a status read that the fake was asked AFTER the act (waited for: no clock).
        await expect
          .poll(async () => {
            const verbs = await backend.verbs();
            const at = verbs.findIndex((verb) => row.at.test(verb));
            return at >= 0 && verbs.slice(at + 1).includes("status");
          }, { timeout: 20_000 })
          .toBe(true);
      }
      await core.reread().catch(() => undefined);
    }, 60_000);
  }
});
