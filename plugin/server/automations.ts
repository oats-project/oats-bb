// Automations' RPC handlers. The two lists are read together, once for all clients that ask while
// the roster stands as it was read: whatever makes the server read OATS again (an event of the
// deployment, one of the plugin's own acts, Retry, the slow poll) makes the next client's lists
// new too. A trigger's state is read for a trigger the current list names, and no other id
// reaches the host.
import type { ExperimentalPluginRpcHandlersWithContext } from "@get-bb/plugin-sdk";
import type { z } from "zod";
import { NO_AUTOMATIONS, type AutomationKind, type AutomationRow, type automationListAnswer, type rpc } from "../contract/automations.js";
import { PULL_REQUEST } from "../model/automations.js";
import { codes, isKernelCode } from "../kernel/result.js";
import { HOST_TIMEOUT, invalid, refusal, refusedWith, type Core } from "./core.js";

/** The longest one read of the lists serves: the page, the sidebar's mark and a second window ask at once. */
export const LISTS_TTL_MS = 30_000;

type ListAnswer = z.infer<typeof automationListAnswer>;
type Lists = z.infer<(typeof rpc)["automations"]["output"]>;

/** A refusal as the client is told it: the kernel's code and message, or the plugin's own. */
function failed(error: unknown): ListAnswer {
  const code = (typeof error === "object" && error !== null ? refusedWith.get(error) : undefined) ?? codes.failed;
  const said = error instanceof Error ? error.message : String(error);
  // The refusal's own message leads with its code ("E_…: …"); the code travels beside it here.
  return { ok: false, code, message: said.startsWith(`${code}: `) ? said.slice(code.length + 2) : said };
}

export const handlers = (core: Core): ExperimentalPluginRpcHandlersWithContext<typeof rpc> => {
  /** The lists, the roster read they were made beside (its `at`), whether that read has ended, and whether an act has run since it started. */
  let held: { at: number; roster: string; value: Promise<Lists>; settled: boolean; stale: boolean } | null = null;
  /** The one read that waits behind a read still running: every ask of a newer roster shares it. */
  let queued: Promise<Lists> | null = null;
  /** The newest roster read an ask waits with: the queued read is made beside it. */
  let waiting = "";

  const read = (kind: "scheduleList" | "triggerList"): Promise<ListAnswer> =>
    core.call(kind, {}, HOST_TIMEOUT.read, core.signal).then(
      (list) => ({ ok: true as const, list }),
      (error: unknown) => failed(error),
    );
  /** Both lists: this read, or the one made beside the same roster read, if it is recent. */
  const lists = async (): Promise<Lists> => {
    const snapshot = await core.clientSnapshot();
    const roster = snapshot.at;
    if (held !== null && !held.stale && held.roster === roster && Date.now() - held.at < LISTS_TTL_MS) return held.value;
    // What the plugin itself lacks (no machine, no deployment, no `oats` there) is said once, in
    // the server's own words for it, which name the machine and what to do: no list is asked for.
    if (!snapshot.ok && !isKernelCode(snapshot.code)) {
      const lack: ListAnswer = { ok: false, code: snapshot.code, message: snapshot.message };
      return { at: snapshot.at, hostId: null, oats: null, schedule: lack, trigger: lack };
    }
    // Never two reads at once: with a kernel whose lists are slow and a roster that keeps changing,
    // each ask would start another pair of processes. One read runs and one waits behind it.
    if (held !== null && !held.settled) {
      waiting = roster;
      const after = () => {
        queued = null;
        return start(waiting);
      };
      queued ??= held.value.then(after, after);
      return queued;
    }
    return start(roster);
  };
  /** Reads both lists now, beside that roster read. */
  const start = (roster: string): Promise<Lists> => {
    const value = (async (): Promise<Lists> => {
      // The kernel's own word on what it can do; when it cannot be asked, the lists' refusals say why.
      const version = await core.versionOf().catch(() => null);
      const oats = version === null ? null : { version: version.version, features: version.features, automationsApi: version.apis.automationsApi ?? null };
      const supported = oats === null || (oats.features.includes("automations") && oats.automationsApi === 1);
      const none: ListAnswer = { ok: false, code: NO_AUTOMATIONS, message: `OATS ${oats?.version ?? ""} has no automations lists: they need OATS 0.29 or later.` };
      const [schedule, trigger] = supported ? await Promise.all([read("scheduleList"), read("triggerList")]) : [none, none];
      return { at: new Date().toISOString(), hostId: core.target()?.hostId ?? null, oats, schedule, trigger };
    })();
    const entry = { at: Date.now(), roster, value, settled: false, stale: false };
    const done = () => {
      entry.settled = true;
    };
    value.then(done, done);
    held = entry;
    return value;
  };

  /** The row of the current list an act names: by its qualified id, or a bare local one. An id the list does not name reaches no process. */
  const rowOf = async (kind: AutomationKind, id: string): Promise<AutomationRow> => {
    const answer = (await lists())[kind];
    // A list that could not be read names nothing: the act is refused with why the list could not be read, never as "no such row".
    if (!answer.ok) throw refusal({ code: answer.code, message: answer.message });
    const row = answer.list.rows.find((entry) => entry.id === id || entry.id === `local/${id}`);
    if (row === undefined) throw invalid(`"${id}" is not a ${kind} of this OATS deployment's current list`);
    return row;
  };
  /** After an act: the lists are read again for the next client, and so is the roster (a run launches an agent). */
  const changed = () => {
    // Not dropped: a read still running is waited for, so the next lists are read after it and never beside it.
    if (held !== null) held.stale = true;
    core.rereadSoon();
  };
  /** An act is not ended by its caller going away: only by the plugin's own end. */
  const act = async <Value>(run: () => Promise<Value>): Promise<Value> => {
    try {
      return await run();
    } finally {
      changed();
    }
  };

  return {
    automations: () => lists(),

    async automationEnable({ kind, id, enabled }) {
      const row = await rowOf(kind, id);
      return act(() => core.call("automationEnable", { kind, id: row.id, enabled }, HOST_TIMEOUT.act, core.signal));
    },
    async scheduleRun({ id }) {
      const row = await rowOf("schedule", id);
      return act(() => core.call("scheduleRun", { id: row.id }, HOST_TIMEOUT.long, core.signal));
    },
    async automationTest({ kind, id, runSource }, context) {
      const row = await rowOf(kind, id);
      const source = row.on?.source ?? null;
      // Only a trigger on a capability's source has a command a test could run, and only a confirmed press runs it.
      if (runSource === true && (kind !== "trigger" || source === null || source === PULL_REQUEST)) throw invalid(`${row.id} has no capability source for a test to run`);
      // A test changes nothing: it is ended with its caller.
      return core.call("automationTest", { kind, id: row.id, source, runSource: runSource === true }, HOST_TIMEOUT.preview, context.experimental_signal);
    },
    async automationDescribe({ kind, id, description }) {
      const row = await rowOf(kind, id);
      return act(() => core.call("automationDescribe", { kind, id: row.id, description }, HOST_TIMEOUT.act, core.signal));
    },
    async scheduleRemove({ id }) {
      const row = await rowOf("schedule", id);
      return act(() => core.call("scheduleRemove", { id: row.id }, HOST_TIMEOUT.act, core.signal));
    },
    async scheduleReconcile({ id }) {
      const row = await rowOf("schedule", id);
      return act(() => core.call("scheduleReconcile", { id: row.id }, HOST_TIMEOUT.act, core.signal));
    },
    schedulerEnable: () => act(() => core.call("schedulerEnable", {}, HOST_TIMEOUT.act, core.signal)),

    async triggerStatus({ id }, context) {
      const row = await rowOf("trigger", id);
      return core.call("triggerStatus", { id: row.id, source: row.on?.source ?? null }, HOST_TIMEOUT.read, context.experimental_signal);
    },
  };
};
