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
      for (const verb of ACTS) if (new RegExp(`\\.call\\(\\s*["'\`]${verb}["'\`]`).test(source)) around.push(`${name}: call("${verb}")`);
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
    expect(outcomeOf("retireApply", { children: [], incomplete: [] })).toEqual({ result: "ok", homes: "1/1" });
    expect(outcomeOf("retireApply", { children: [row(true), row(false)], incomplete: [] })).toEqual({ result: "INCOMPLETE", homes: "2/3" });
    expect(outcomeOf("retireApply", { children: [row(true)], incomplete: ["the worktree was kept"] })).toEqual({ result: "INCOMPLETE", homes: "2/2" });
    expect(outcomeOf("spawn", { instance: "made-1" })).toEqual({ result: "ok", made: "made-1" });
    expect(outcomeOf("start", { instance: "a", results: [row(false)] })).toEqual({ result: "ok" }); // only a stop's and a retire's receipts are read so
    expect(outcomeOf("schedulerEnable", null)).toEqual({ result: "ok" });
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
    expect(acts()[0]!.line).toMatch(/ host=- at=\S+ n=1 result=HELD:error why=the_guard_s_own_refusal$/);
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
    expect([last.level, last.line.replace(/^.* n=\d+ /, "").replace(/ms=\d+/, "ms=N")]).toEqual(["warn", "result=INCOMPLETE ms=N homes=2/2"]);
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
});
