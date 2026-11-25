// What every feature's server module builds on: the settings, where `oats` runs (the machine and
// the deployment), the calls to the host entry, one cached snapshot for all clients and the realtime
// invalidation. It runs no process: every `oats` runs in the host entry (host.ts), on the machine
// that holds the homes, and the server never sends an argv. A feature's RPC handlers are in
// server/<feature>.ts; server.ts composes them.
import { experimental_PluginRpcRefusal, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { CHANGED_FILES_MAX, hostContract, hostSignals, REALTIME_CHANGED, type snapshot as snapshotSchema } from "../contract/index.js";
import { UNCONFIRMED_ISSUE } from "../contract/shared.js";
import { codes, type KernelError } from "../kernel/result.js";
import { withEvents, type EventsSaid } from "../model/events.js";
import type { Agent } from "../model/types.js";
import { actLine, callerOf, isAct, outcomeOf, type Act, type ActVerb, type Asker, type Subject } from "./act-log.js";

/** What the kernel printed for one instance: its own row, and its agent group's row without the instances. */
export type RawRow = { readonly row: Readonly<Record<string, unknown>>; readonly agent: Readonly<Record<string, unknown>> };

/** The slow poll, while at least one client is connected. */
export const POLL_MS = 15_000;
/**
 * The pause between the end of one `oats status` and the start of the next: this, or as long as
 * the last status took to answer, whichever is longer (a read that failed is followed by this
 * floor). One read is excepted, the read at once (FOLLOW_UP_WITHIN_MS, below, which also says what
 * share of its time a kernel then spends on status). (The first spec's "never within 5 s of the
 * last" gave way to this.)
 */
export const MIN_INTERVAL_MS = 1_000;
/**
 * ONE read at once. A change that arrives while a read is in flight may be missed by that read, so
 * another must follow; when the read in flight answered within this limit, the next one starts at
 * once, with no pause, and once: a change that arrives during that second read waits the pause
 * again (the pause after the pair is the rule above, counted from the second).
 *
 * What it buys, with t the time one status takes: a change that lands in the FIRST read of a pair
 * is on the screen after about two reads (2t) instead of two reads and the pause. A change that
 * lands in the SECOND read (the one started at once: the clear after a set, the second event of
 * one act) still waits that read, the pause and the next: 2t + max(1 s, t), as before this rule.
 * No read is later than it was; the worst case is not shorter, the common one is.
 *
 * Why 2 s and not the floor's 1 s: on the pilot's host one `oats status` took 1.05 to 1.52 s under
 * load (measured 2026-11-23, eight agents, load 16), and with a limit of 1 s no read there would be
 * followed at once: a change in the middle of a read stayed at two reads and the pause, 3.3 to
 * 4.3 s, over the 3 s of the UX standard (section 6, amended by the specialist on 23 Nov to this
 * condition). With 2 s it is two reads there: 2.1 to 3.04 s, before the host call's own overhead:
 * at the slow end still at the bar's edge, not under it.
 * The cost, in a sustained burst of changes: a kernel that answers in t spends 2t of every
 * 2t + max(1 s, t) on status (63 % at 0.85 s, 67 % from 1 s to 2 s), not "at most half". A kernel
 * slower than 2 s keeps the pause after every read (at most half its time on status): it is over
 * the 3 s whatever the pacing.
 */
export const FOLLOW_UP_WITHIN_MS = 2_000;
/**
 * Whether a read that was asked for while another was in flight starts at once when that one ends
 * (see FOLLOW_UP_WITHIN_MS): only after a read that ANSWERED (a failed one says nothing of the
 * kernel's speed, and its retry waits the floor), within the limit, and that was not itself a read
 * started at once.
 */
export function followsAtOnce(inFlight: { answeredInMs: number | null; startedAtOnce: boolean }): boolean {
  return !inFlight.startedAtOnce && inFlight.answeredInMs !== null && inFlight.answeredInMs <= FOLLOW_UP_WITHIN_MS;
}
/** The most `oats instance events` reads alive at once, for all instances together (the event path: `askEvents`). */
export const EVENTS_READS_MAX = 2;
/** How long the answers behind the four pages are reused. */
const PAGE_TTL_MS = 30_000;
/** A client that asked for the snapshot this recently counts as connected, beside the watched reads. */
const CLIENT_SEEN_MS = 45_000;
/**
 * Host-call limits. The kernel's own limit (kernel/index.ts) must answer first, so that a slow
 * `oats` is the typed OATS_TIMEOUT and not a lost call. For a verb the host contract marks
 * `experimental_retryable`, bb cancels the call and sends it once more at HALF this limit: so `read`
 * and `preview` are more than twice the kernel's 20 s and 45 s. The acts are not retryable.
 */
export const HOST_TIMEOUT = { read: 45_000, preview: 100_000, act: 125_000, long: 26 * 60_000 } as const;

export type Snapshot = z.infer<typeof snapshotSchema>;
export type Target = { hostId: string; deployment: string; machine: string };
type Failure = { ok: false; code: string; message: string; machine?: string | null };
type Answer<Value> = { ok: true; value: Value } | { ok: false; error: KernelError };

const hostRow = z.looseObject({ id: z.string(), name: z.string().nullish() });
const projectRow = z.looseObject({
  sources: z.array(z.looseObject({ hostId: z.string().nullish(), path: z.string().nullish() })).nullish(),
});

const lastSegment = (path: string): string => path.split("/").filter(Boolean).pop() ?? path;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

/** The kernel's (or the plugin's) code behind each refusal built here, for the handlers that act on one. */
export const refusedWith = new WeakMap<object, string>();

/**
 * A kernel refusal or a failed `oats`, as the RPC refusal the app shows: the code, then the message,
 * unchanged. The kernel's marker that it could not confirm what is left (`KernelError.unconfirmed`)
 * goes with it as the refusal's one issue (contract/shared.ts `UNCONFIRMED_ISSUE`).
 */
export function refusal(error: KernelError): experimental_PluginRpcRefusal {
  const refused = new experimental_PluginRpcRefusal({
    code: error.code === codes.invalidInput ? "invalid" : "conflict",
    message: error.code === codes.invalidInput ? error.message : `${error.code}: ${error.message}`,
    ...(error.unconfirmed === true ? { issues: [{ message: UNCONFIRMED_ISSUE.message, path: [...UNCONFIRMED_ISSUE.path] }] } : {}),
  });
  refusedWith.set(refused, error.code);
  return refused;
}
export const invalid = (message: string) => new experimental_PluginRpcRefusal({ code: "invalid", message });

/** A host verb that runs `oats` in the deployment: every one but the two that find and watch it. */
export type Verb = Exclude<keyof typeof hostContract, "discover" | "watch">;
type Extra<Method extends Verb> = Omit<z.input<(typeof hostContract)[Method]["input"]>, "deployment" | "oatsBin">;
/** What a verb answers when `oats` did not refuse. */
export type Value<Method extends Verb> = Extract<z.output<(typeof hostContract)[Method]["output"]>, { ok: true }>["value"];

export type Core = ReturnType<typeof createCore>;

export function createCore(bb: BbPluginApi) {
  const settings = bb.settings.define({
    deployment: {
      type: "string",
      label: "OATS deployment directory",
      description: "The directory that holds oats-local.yaml. Empty: found from the bb projects on the machine.",
      default: "",
    },
    oatsBin: {
      type: "string",
      label: "Path to oats",
      description: "An absolute path to the oats command. Empty: oats on the machine's PATH.",
      default: "",
    },
    host: {
      type: "string",
      label: "Machine",
      description: "The bb machine (its name or id) that holds the OATS homes. Empty: this server's only machine.",
      default: "",
    },
    // Read by the app alone (app/workspace/pages.ts `pagesShown`): the server keeps no page.
    pages: {
      type: "string",
      label: "Pages shown",
      description:
        "The plugin's pages that are shown, by id, separated by commas. The default is home. The others are not finished yet and are left out until they are: automations, souls, capabilities, teams, machines.",
      default: "home",
    },
  });
  const host = bb.hosts.experimental_client({ contract: hostContract, experimental_signals: hostSignals });
  const lifetime = new AbortController();
  /** How many acts this server has carried: an act's number, on each of its lines (server/act-log.ts). */
  let acts = 0;

  let target: Target | null = null;
  /** Counts the settings changes, so that a discovery that read the old settings is not kept. */
  let settingsGeneration = 0;
  let watchAsserted = false;
  let cached: Snapshot | null = null;
  /** What the kernel printed behind the last roster read: its root, and each instance's rows; null before any. */
  let rawRows: { at: string; root: string; rows: ReadonlyMap<string, RawRow> } | null = null;
  /**
   * The last roster read, as the status read answered it, kept while OATS cannot be read. (While
   * the snapshot is a roster, `cached` is this with the event path's patches over it: a status
   * read that FAILS shows this one, so a patch leaves the screen with it: what is then shown is
   * the last thing `oats status` said.)
   */
  let lastRoster: Extract<Snapshot, { ok: true }> | null = null;
  let comparable = "";
  let lastStart = 0;
  /** When the last read ended: what the pause before the next is counted from. */
  let lastEnd = 0;
  /**
   * How long the last read took when it answered; null when it gave no answer to count: it failed
   * (a timeout, an unreachable machine, no oats: its own length must not hold back Retry or the
   * watch), or it answered for settings that changed under it. The pause after it is this, or the floor.
   */
  let lastAnsweredInMs: number | null = null;
  /** Whether the last read to start was started at once after the one before it (FOLLOW_UP_WITHIN_MS). */
  let lastStartedAtOnce = false;
  let running: Promise<Snapshot> | null = null;
  let queued: Promise<Snapshot> | null = null;
  /**
   * An act that ENDED asked for a status read (`rereadAfterAct`): the first read that STARTS from
   * now is published whether or not it differs. The window holds "Reading…" over an agent until it
   * has a roster read after the act's end (app/roster/reading.tsx: the roster's `at` against the
   * act's `endedAt`), and a read that says nothing new is not published otherwise: the kernel
   * writes its event before the act's command returns, so a read that started before the act's end
   * can already hold the final state, and the window would never learn that a later one was made.
   */
  let owedToActs = false;
  // ---- the event path (below, "between two status reads") ----
  /**
   * Per instance, the last events answer applied to its row, and when the read that brought it
   * STARTED: kept so that a status answer OLDER than it (a status read that started before it) does
   * not take the change off the screen again. Dropped by the first status read that started after it.
   */
  const patches = new Map<string, { said: EventsSaid; startedAt: number }>();
  /**
   * The agents of the status read the snapshot is of, as that read answered them (no patch): a
   * patch is always computed from these, never from a row that is patched already, so that a later
   * events answer can take an earlier one's change off again. Null while the snapshot is no roster.
   */
  let statusAgents: Agent[] | null = null;
  /** The last token published (epoch ms): every publish carries one that is later than every one before it. */
  let lastToken = 0;
  /** The last stamp given (epoch ms): `stamp`. */
  let lastStamp = 0;
  /** The instances whose events are being read now; `again`: a signal named it meanwhile, and one more read follows. */
  const eventsReads = new Map<string, { again: boolean }>();
  /** The instances that wait for their events to be read, in the order they were named (each once). */
  const eventsLine: string[] = [];
  let watchers = 0;
  let clientSeenAt = 0;
  const pages = new Map<string, { at: number; value: Promise<unknown> }>();

  // ---- where `oats` runs ----

  const fail = (code: string, message: string, machine: string | null = null): Failure => ({ ok: false, code, message, machine });

  async function findTarget(signal: AbortSignal): Promise<Target | Failure> {
    const values = await settings.get();
    const hosts = z.array(hostRow).parse(await bb.sdk.hosts.list({ signal }));
    const names = hosts.map((row) => row.name ?? row.id).join(", ");
    let chosen: z.infer<typeof hostRow> | undefined;
    if (values.host !== "") {
      chosen = hosts.find((row) => row.id === values.host) ?? hosts.find((row) => row.name === values.host);
      if (!chosen) {
        // The machine that was not found is the one the setting names.
        return fail(codes.hostNotFound, `The machine "${values.host}" in the OATS plugin's settings is not one of this bb server's machines (${names || "none"}).`, values.host);
      }
    } else if (hosts.length === 1) {
      chosen = hosts[0];
    } else if (hosts.length === 0) {
      return fail(codes.noHost, "No machine is connected to this bb server, so the OATS plugin has nowhere to run oats.");
    } else {
      return fail(codes.chooseHost, `This bb server has ${hosts.length} machines (${names}). Choose the one that holds the OATS homes: set "Machine" in the OATS plugin's settings.`);
    }
    if (!chosen) return fail(codes.noHost, "No machine is connected to this bb server, so the OATS plugin has nowhere to run oats.");
    const hostId = chosen.id;
    const roots: string[] = [];
    if (values.deployment === "") {
      for (const project of z.array(projectRow).parse(await bb.sdk.projects.list({ signal }))) {
        for (const source of project.sources ?? []) {
          if (source.hostId === hostId && source.path && !roots.includes(source.path)) roots.push(source.path);
        }
      }
    }
    const found = await host.call("discover", { deployment: values.deployment, roots }, { hostId, signal, timeoutMs: HOST_TIMEOUT.read });
    if (found.deployment === null) {
      return fail(
        codes.noDeployment,
        values.deployment === ""
          ? `No OATS deployment found on ${found.machine}: no bb project there is in a directory that holds oats-local.yaml. Set the deployment directory in the OATS plugin's settings.`
          : `No OATS deployment found on ${found.machine}: ${values.deployment} holds no oats-local.yaml. Correct the deployment directory in the OATS plugin's settings.`,
        chosen.name ?? found.machine,
      );
    }
    // The machine is shown by the name bb gives it (the one a person sees in bb), never by the
    // host's own name, which in a container is a raw id.
    return { hostId, deployment: found.deployment, machine: chosen.name ?? found.machine };
  }

  async function base(signal: AbortSignal): Promise<{ target: Target; input: { deployment: string; oatsBin: string } } | Failure> {
    let at = target;
    if (at === null) {
      const generation = settingsGeneration;
      const found = await findTarget(signal);
      if ("ok" in found) return found;
      at = found;
      // Kept only if the settings it was found with are still the settings.
      if (generation === settingsGeneration) {
        target = found;
        watchAsserted = false;
      }
    }
    return { target: at, input: { deployment: at.deployment, oatsBin: (await settings.get()).oatsBin } };
  }

  /** The watch dies with the host worker: it is asserted again whenever it may be gone. */
  async function assertWatch(at: Target): Promise<void> {
    if (watchAsserted) return;
    try {
      const answer = await host.call("watch", { deployment: at.deployment }, { hostId: at.hostId, signal: lifetime.signal, timeoutMs: HOST_TIMEOUT.read });
      watchAsserted = answer.watching !== null && target === at;
    } catch (error) {
      bb.log.warn(`the watch on ${at.deployment} could not be started (the ${POLL_MS / 1000} s poll carries changes): ${String((error as Error).message)}`);
    }
  }

  // ---- the one cached snapshot ----

  async function read(): Promise<Snapshot> {
    // A read that began under other settings must not bring their roster back once they changed.
    const generation = settingsGeneration;
    // Taken as the read STARTS: a read in flight when the act ended has passed this line, and is not the one owed.
    const forAct = owedToActs;
    owedToActs = false;
    lastStart = stamp(); // (not the bare clock: a read that starts in the millisecond an act ended is LATER than the act's end)
    const at = new Date(lastStart).toISOString();
    let next: Snapshot;
    let rows: Map<string, RawRow> | null = null;
    let root = "";
    /** The machine `oats` is being called on, once it is known: a call that throws still names it. */
    let machine: string | null = null;
    try {
      const where = await base(lifetime.signal);
      if ("ok" in where) {
        next = { ...where, at };
      } else {
        machine = where.target.machine;
        const answer = await host.call("status", where.input, { hostId: where.target.hostId, signal: lifetime.signal, timeoutMs: HOST_TIMEOUT.read });
        if (answer.ok) {
          const workspace = answer.value.workspace ? lastSegment(answer.value.workspace) : lastSegment(where.target.deployment);
          next = { ok: true, at, deployment: { root: where.target.deployment, workspace, machine: where.target.machine }, agents: answer.value.agents };
          root = answer.value.root;
          rows = new Map();
          // By instance, the first row of a name: the row `agentOf` finds.
          answer.value.agents.forEach((agent, index) => {
            const row = answer.value.rows[index];
            if (row !== undefined && !rows!.has(agent.instance)) rows!.set(agent.instance, row);
          });
          void assertWatch(where.target);
        } else {
          const message =
            answer.error.code === codes.notFound
              ? `oats was not found on ${where.target.machine}: install OATS there, or set the path to oats in the OATS plugin's settings. (${answer.error.message})`
              : answer.error.message;
          next = { ok: false, at, code: answer.error.code, message, machine: where.target.machine };
          // The deployment may have moved or gone: look for it again at the next read.
          target = null;
        }
      }
    } catch (error) {
      next = { ok: false, at, code: codes.hostUnreachable, message: `The machine that runs oats did not answer: ${String((error as Error).message)}`, machine };
      target = null;
    }
    // A change is a change of anything the kernel printed: a feature may draw a field of a raw row
    // that the snapshot's agents do not hold.
    if (next.ok) {
      // Kept as "the last roster" only for the settings it was read under: after a change of machine
      // or deployment it is the old one's, and must not be shown as this one's last observation,
      // nor lend its homes to an act (the read that the change queued brings the new one).
      if (generation === settingsGeneration) {
        lastRoster = next;
        rawRows = rows === null ? null : { at, root, rows };
      }
    } else {
      // What was read before stays, with its age: no place falls back to nothing where there was a roster.
      next = { ...next, last: lastRoster === null ? null : { at: lastRoster.at, deployment: lastRoster.deployment, agents: lastRoster.agents } };
    }
    // A read that began under settings that have changed since is not this deployment's answer:
    // nothing keeps it (the change emptied `cached`, and the read it queued brings the new one), so
    // no client is shown it and no act finds an agent, or a home, of the old deployment in it.
    if (generation !== settingsGeneration) {
      lastEnd = Date.now();
      lastAnsweredInMs = null;
      if (forAct) owedToActs = true; // not this deployment's answer: the read the change queued owes the act its publish
      return next;
    }
    // The event path's patches that are NEWER than this read (their events read started after this
    // status read did) still stand over it; the others are older than it, and this read is the truth.
    patchesOlderThan(lastStart);
    statusAgents = next.ok ? next.agents : null;
    if (next.ok) next = { ...next, agents: withPatches(next.agents, next.at) };
    const key = keyOf(next, root, rows);
    const changed = key !== comparable;
    cached = next;
    comparable = key;
    lastEnd = Date.now();
    // Only a status that answered lengthens the pause: the guard is for a kernel that answers
    // slowly. After a read that failed (a timeout, an unreachable machine, no oats) the next one
    // waits the floor, so Retry and the watch are not held back by the failure's own length.
    lastAnsweredInMs = next.ok ? lastEnd - lastStart : null;
    // Published when it differs; and, the same or not, when an act that ended is owed it (`owedToActs`).
    if ((changed || forAct) && !lifetime.signal.aborted) bb.realtime.publish(REALTIME_CHANGED, { at: token(lastStart) });
    return next;
  }

  // ---- between two status reads: the event path ----
  //
  // A change OATS itself makes (a claim set or cleared, a stop) appends a line to that instance's
  // file in the deployment's event log, and the watch names the file. `oats instance events` for
  // ONE instance answers in about a tenth of a status read: the server reads it, moves that
  // agent's row to what it says (model/events.ts `withEvents`: the claim and a stop, nothing
  // else) and publishes, so that the change is on the screen without waiting for `oats status`.
  // The status read is asked for exactly as before, and it is the truth:
  //
  // - Every answer is ranked by WHEN ITS READ STARTED. An events answer whose read started before
  //   the snapshot's status read did is dropped (that status read is newer). A status answer whose
  //   read started before an events read that patched a row is OLDER than the patch: the same
  //   function is applied to its row again from the kept answer (`withPatches`), so the change
  //   does not leave the screen and come back. The first status read that started AFTER that
  //   events read is taken whole, and the kept answer is dropped.
  // - FAIL SAFE: an events read that fails, times out, answers a shape this does not know, or is
  //   for an instance the snapshot does not hold changes nothing, and is said at debug level.
  // - Only the snapshot's agents are patched. What the kernel printed (`rawRows`: the lifecycle's
  //   and the automations' reads) is the status read's alone: an act on a patched agent reads the
  //   kernel's own row and goes to the kernel, as it does on any roster that is a moment old.
  // - The snapshot's `at` stays the status read's start: it is how old the roster is.

  /** What tells one shown snapshot from another: everything of it but when it was read, and what the kernel printed beside it. */
  const keyOf = (snapshot: Snapshot, root: string, rows: ReadonlyMap<string, RawRow> | null): string =>
    JSON.stringify({ ...snapshot, at: null, last: snapshot.ok ? null : (snapshot.last?.at ?? null), root, rows: rows === null ? null : [...rows] });
  /**
   * The token of a publish: `wanted` (the start of the read behind it, epoch ms), or the first
   * millisecond after the last token where that is not later. A client acts once per token
   * (app/store.ts), and two reads can start in one millisecond (two instances named by one
   * signal; a status read asked for by the signal that named them): each publish gets its own.
   */
  function token(wanted: number): string {
    lastToken = Math.max(wanted, lastToken + 1);
    return new Date(lastToken).toISOString();
  }
  /**
   * This server's clock for WHEN A STATUS READ STARTED (the roster's `at`) and WHEN AN ACT ENDED
   * (`actEnded`): the time now, or the first millisecond after the last stamp where that is not
   * later. The window compares the two ("Reading…" stands while the roster's `at` is not later
   * than the act's end: app/roster/reading.tsx), and both are whole milliseconds: a read that
   * starts in the very millisecond the act ended would be a tie, read as "before", with no later
   * read owed. One strictly increasing stamp for both: of two events on this server the later has
   * the later stamp, always. (It can run a millisecond ahead of the clock in such a tie; nothing
   * reads it as a wall time but the roster's age, in minutes.)
   */
  function stamp(): number {
    lastStamp = Math.max(Date.now(), lastStamp + 1);
    return lastStamp;
  }
  /** When an act ended, for its answer's `endedAt`: taken as its `oats` command returned (server/lifecycle.ts). */
  const actEnded = (): string => new Date(stamp()).toISOString();
  /** Drops the kept answers a status read that started at `statusStart` is newer than. */
  function patchesOlderThan(statusStart: number): void {
    for (const [instance, kept] of patches) if (kept.startedAt <= statusStart) patches.delete(instance);
  }
  /** A status read's own agents, with every kept answer applied (each is newer than that read: the older ones were dropped). */
  function withPatches(agents: Agent[], readAt: string): Agent[] {
    if (patches.size === 0) return agents;
    return agents.map((agent) => {
      const kept = patches.get(agent.instance);
      return kept === undefined ? agent : withEvents(agent, kept.said, readAt);
    });
  }
  /** What a patch changed, in words for the log. */
  const patchSaid = (before: Agent, after: Agent): string =>
    [
      before.waiting === null && after.waiting !== null ? "a claim set" : null,
      before.waiting !== null && after.waiting === null ? "the claim cleared" : null,
      before.waiting !== null && after.waiting !== null && JSON.stringify(before.waiting) !== JSON.stringify(after.waiting) ? "the claim changed" : null,
      before.running !== false && after.running === false ? "stopped" : null,
      before.running === false && after.running !== false ? "not stopped after all (its events say it started again): as the status read said" : null,
    ]
      .filter((part) => part !== null)
      .join(", ") || "the row";

  /**
   * Asks for one instance's events to be read. Never two reads at once for one instance (a signal
   * that names it meanwhile makes one more read, when this one has ended), and never more than
   * EVENTS_READS_MAX `oats` at once for all of them: a sweep or a mass stop writes many instances'
   * files in separate batches, and the plugin must not start a process per agent on a host that
   * is loaded already (what the status read's pause is for). The others wait in line, in the
   * order they were named, each once. A line of more than CHANGED_FILES_MAX is dropped whole:
   * the status read, which every signal asks for, carries them.
   */
  function askEvents(instance: string): void {
    const reading = eventsReads.get(instance);
    if (reading !== undefined) {
      reading.again = true;
      return;
    }
    if (eventsLine.includes(instance)) return;
    if (eventsReads.size < EVENTS_READS_MAX && eventsLine.length === 0) startEvents(instance);
    else inLine(instance);
  }
  function inLine(instance: string): void {
    eventsLine.push(instance);
    if (eventsLine.length > CHANGED_FILES_MAX) {
      bb.log.debug(`the event path: ${eventsLine.length} instances wait for their events to be read: none of them is read, the status read carries them`);
      eventsLine.length = 0;
    }
  }
  /** Starts a read nobody awaits: whatever it throws is said at debug level and changes nothing (fail safe, by construction). */
  const startEvents = (instance: string): void =>
    void readEvents(instance).catch((error: unknown) => bb.log.debug(`the event path: ${instance}: nothing changed: its read ended with ${String((error as Error)?.message ?? error)}`));
  /** Reads one instance's events, and then the next in line. */
  async function readEvents(instance: string): Promise<void> {
    const mine = { again: false };
    eventsReads.set(instance, mine);
    try {
      await readEventsOnce(instance);
    } finally {
      eventsReads.delete(instance);
      if (!lifetime.signal.aborted) {
        // Named again meanwhile: one more read, behind those that wait already.
        if (mine.again) inLine(instance);
        // The place this read leaves is the next in line's.
        const next = eventsLine.shift();
        if (next !== undefined) startEvents(next);
      }
    }
  }
  async function readEventsOnce(instance: string): Promise<void> {
    const dropped = (why: string) => bb.log.debug(`the event path: ${instance}: nothing changed: ${why}`);
    const generation = settingsGeneration;
    const from = cached;
    const at = target;
    const agent = from !== null && from.ok ? from.agents.find((candidate) => candidate.instance === instance) : undefined;
    if (from === null || !from.ok || agent === undefined || at === null) return dropped("the snapshot holds no such agent now");
    const startedAt = Date.now();
    let answer: Answer<EventsSaid>;
    try {
      answer = await host.call(
        "rosterEvents",
        { deployment: at.deployment, oatsBin: (await settings.get()).oatsBin, instance, home: agent.home, since: from.at },
        { hostId: at.hostId, signal: lifetime.signal, timeoutMs: HOST_TIMEOUT.read },
      );
    } catch (error) {
      return dropped(`its events could not be read: ${String((error as Error).message)}`);
    }
    const took = Date.now() - startedAt;
    if (!answer.ok) return dropped(`oats instance events answered ${answer.error.code} in ${took} ms`);
    if (generation !== settingsGeneration || lifetime.signal.aborted) return dropped("the settings changed while its events were read");
    const now = cached;
    if (now === null || !now.ok) return dropped("OATS cannot be read now: the roster shown is the last one read");
    // A status read that started after this events read did is newer than it: it is the truth.
    if (Date.parse(now.at) >= startedAt) return dropped(`a status read that started after its events read (${took} ms) has answered`);
    const shown = now.agents.find((candidate) => candidate.instance === instance);
    // (The status read's own agents hold the same instances as the snapshot: one block of read() sets both.)
    if (shown === undefined || statusAgents === null || !statusAgents.some((candidate) => candidate.instance === instance)) return dropped("the snapshot holds no such agent now");
    // The row is computed from what the STATUS read said of it, with this answer in the place of any
    // earlier one: never from a row that is patched already (an answer that says "stopped, then
    // started again" must take an earlier answer's "stopped" off).
    patches.set(instance, { said: answer.value, startedAt });
    const agents = withPatches(statusAgents, now.at);
    const next = agents.find((candidate) => candidate.instance === instance)!;
    const patchedSnapshot: Snapshot = { ...now, agents };
    const key = keyOf(patchedSnapshot, rawRows?.root ?? "", rawRows?.rows ?? null);
    if (key === comparable) return dropped(`its events say what is shown (read in ${took} ms)`);
    cached = patchedSnapshot;
    comparable = key;
    bb.log.debug(`the event path: ${instance}: ${patchSaid(shown, next)}, from its events read in ${took} ms`);
    // The token is this read's start (or the next free one), not the snapshot's `at`, which stays the status read's.
    if (!lifetime.signal.aborted) bb.realtime.publish(REALTIME_CHANGED, { at: token(startedAt) });
  }
  /** The agent of the snapshot whose event file is `file` (`<agent>--<instance>.jsonl`), when exactly one is. */
  function agentOfFile(file: string): string | null {
    if (cached === null || !cached.ok) return null;
    const named = cached.agents.filter((agent) => `${agent.soul}--${agent.instance}.jsonl` === file);
    return named.length === 1 ? named[0]!.instance : null;
  }

  /**
   * The next read that starts from now on: after the one in flight, and never sooner after the
   * last one ended than MIN_INTERVAL_MS or the time that one took to answer, whichever is longer. Callers
   * asking meanwhile share it. The one exception is the read asked for WHILE another is in flight,
   * which starts at once when that one ends, under `followsAtOnce`: what was asked for mid-read may
   * be a change that read did not see.
   */
  function reread(): Promise<Snapshot> {
    if (queued) return queued;
    const inFlight = running;
    const next = (async () => {
      let atOnce = false;
      if (inFlight) {
        await inFlight;
        // (No other read can have started meanwhile: this one is the queued one, and the only next.)
        atOnce = followsAtOnce({ answeredInMs: lastAnsweredInMs, startedAtOnce: lastStartedAtOnce });
        // Said in the log (debug), so that a slow screen can be told from a slow kernel: which rule the read after a read in flight took.
        bb.log.debug(
          atOnce
            ? `oats status is read again at once: asked for while a read was in flight, which answered in ${lastAnsweredInMs} ms`
            : `oats status is read again after the pause: asked for while a read was in flight, which ${lastStartedAtOnce ? "was itself read at once" : lastAnsweredInMs === null ? "gave no answer to count (it failed, or the settings changed under it)" : `answered in ${lastAnsweredInMs} ms, over ${FOLLOW_UP_WITHIN_MS} ms`}`,
        );
      }
      if (!atOnce) await sleep(Math.max(0, lastEnd + Math.max(MIN_INTERVAL_MS, lastAnsweredInMs ?? 0) - Date.now()), lifetime.signal);
      queued = null;
      lastStartedAtOnce = atOnce;
      const mine = read();
      running = mine;
      try {
        return await mine;
      } finally {
        if (running === mine) running = null;
      }
    })();
    queued = next;
    return next;
  }
  const rereadSoon = () => {
    if (!lifetime.signal.aborted) void reread();
  };
  /**
   * For an ACT that has ended (a stop, a start, a restart, a retire): a status read that starts
   * from now on, as `rereadSoon` asks (the queued one, or a new one behind the one in flight), and
   * whose roster is PUBLISHED also when it says nothing new (`owedToActs`): the window waits for it.
   */
  const rereadAfterAct = () => {
    owedToActs = true;
    rereadSoon();
  };

  /**
   * The cached snapshot; before the first one (and after a settings change, which empties it), the
   * answer of the read in flight or of one started now. A read that ended under other settings than
   * it began with keeps nothing: the next one is waited for.
   */
  async function current(): Promise<Snapshot> {
    for (;;) {
      if (cached !== null) return cached;
      const answer = await (running ?? reread());
      if (cached !== null) return cached;
      // Nothing was kept: the read ended under other settings than it began with, and the one the
      // change queued is waited for; or the plugin is stopping, and the answer is all there is.
      if (lifetime.signal.aborted) return answer;
    }
  }

  /**
   * The agent the kernel's snapshot names, for a READ of it; an instance it does not name is
   * refused. While OATS cannot be read after it was, the agent is the one of the last roster read:
   * what a place still shows of it can still be read. With no roster ever read, the failure is the
   * refusal. An act asks `agentForAct`.
   */
  async function agentOf(instance: string): Promise<Agent> {
    const read = await current();
    if (!read.ok && lastRoster === null) throw refusal({ code: read.code, message: read.message });
    const now = read.ok ? read : lastRoster!;
    const found = now.agents.find((agent) => agent.instance === instance);
    if (!found) throw invalid(`"${instance}" is not an agent of this OATS deployment's current snapshot`);
    return found;
  }

  /**
   * The agent an ACT is for: the one the kernel's snapshot names now. While OATS cannot be read no
   * act is taken, also where the last roster is still shown: the acts are held until it is read
   * again (the Desktop's rule), and the failure is the refusal.
   */
  async function agentForAct(instance: string): Promise<Agent> {
    const now = await current();
    if (!now.ok) throw refusal({ code: now.code, message: now.message });
    const found = now.agents.find((agent) => agent.instance === instance);
    if (!found) throw invalid(`"${instance}" is not an agent of this OATS deployment's current snapshot`);
    return found;
  }

  // ---- calls to the host entry ----

  /** Runs one verb on the machine; a kernel refusal, a failed `oats` and an unreachable machine are RPC refusals. */
  /**
   * Asks the host for one verb. `sent` is told the machine's id at the moment the verb is SENT to it (once the
   * machine and the deployment are found): an act logs its "asked" line there, with the machine it was sent to.
   */
  async function ask<Method extends Verb>(method: Method, extra: Extra<Method>, timeoutMs: number, signal: AbortSignal, sent?: (hostId: string) => void): Promise<Value<Method>> {
    let where: Awaited<ReturnType<typeof base>>;
    let answer: Answer<unknown> | null = null;
    try {
      // Finding the machine and the deployment asks bb and the host daemon too: the same refusal.
      where = await base(signal);
      if (!("ok" in where)) {
        const input = { ...where.input, ...extra } as z.input<(typeof hostContract)[Method]["input"]>;
        sent?.(where.target.hostId);
        answer = (await host.call(method, input, { hostId: where.target.hostId, signal, timeoutMs })) as Answer<unknown>;
      }
    } catch (error) {
      throw refusal({ code: codes.hostUnreachable, message: `The machine that runs oats did not answer: ${String((error as Error).message)}` });
    }
    if ("ok" in where) throw refusal({ code: where.code, message: where.message });
    if (answer === null) throw refusal({ code: codes.hostUnreachable, message: "The machine that runs oats did not answer." });
    if (!answer.ok) throw refusal(answer.error);
    return answer.value as Value<Method>;
  }
  /**
   * A READ of the kernel (a read, a preview, a plan, a test): any verb that is no act. An ACT never comes this way:
   * it is refused here, in the types and when it runs, so that no act reaches the kernel without its lines in the
   * log (`act`, below; test/server/act-log.test.ts).
   */
  function call<Method extends Exclude<Verb, Act>>(method: Method, extra: Extra<Method>, timeoutMs: number, signal: AbortSignal): Promise<Value<Method>> {
    if (isAct(method, extra)) return Promise.reject(new Error(`"${String(method)}" is an act: it reaches the kernel through core.act alone, which logs it`));
    return ask(method, extra, timeoutMs, signal);
  }

  /**
   * AN ACT: the ONLY way a verb that changes something reaches the kernel, and it is LOGGED (server/act-log.ts: the
   * line's form, and what never goes in): one line when the kernel is asked, one when it ends (ok, or the kernel's
   * code), and one where the act was HELD: `guards` is everything the plugin checks before it asks (the agent is one
   * the roster names now, a harness is one the provider declares, the row exists): what it throws is logged as the
   * hold and thrown on; what it returns is the verb's input.
   * An act is not ended by its caller going away: only by the plugin's own end (the signal is the plugin's), but
   * where the act says otherwise (`signal`: a test that runs a command is ended with its caller, as it was).
   * → the kernel's answer, and `endedAt`: the server's stamp at the instant the command returned (`actEnded`), taken
   * BEFORE `after` runs (the read an act asks for as it ends: its roster must be stamped after the act's end).
   * `after` runs once the guards passed, whether the kernel answered, refused or was not reached (as each act's own
   * `finally` had it); never where a guard refused.
   */
  async function act<Method extends ActVerb>(method: Method, subject: Subject | (() => Subject), asker: Asker | undefined, timeoutMs: number, guards: () => Promise<Extra<Method>> | Extra<Method>, after?: () => void, signal: AbortSignal = lifetime.signal): Promise<{ value: Value<Method>; endedAt: string }> {
    const n = (acts += 1);
    // The subject is read at each line: an act whose guard finds the row's own id names it by that from then on.
    const about = () => (typeof subject === "function" ? subject() : subject);
    const who = (host: string | null) => ({ caller: callerOf(asker), host, at: new Date().toISOString(), n });
    const codeOf = (error: unknown): string | undefined => (typeof error === "object" && error !== null ? refusedWith.get(error) : undefined);
    // A line that cannot be written never changes an act: a logger that throws is told to the process's own error
    // stream and the act goes on (it matters more than its line).
    const say = (level: "info" | "warn", line: () => string) => {
      try {
        bb.log[level](line());
      } catch (error) {
        console.error(`oats: the act log could not be written (${method}, n=${n}): ${String((error as Error)?.message ?? error)}`);
      }
    };
    let extra: Extra<Method>;
    try {
      extra = await guards();
    } catch (error) {
      const code = codeOf(error);
      // The plugin's own words for its own guard; for a refusal that carries the kernel's code (the roster could not
      // be read; a read the act rests on was refused) the code says it, and the kernel's sentence stays out. A guard
      // that FAILED (no refusal: a fault of the plugin's own) is `error`, not a judgement on what was asked, and its
      // `why` is the fault's NAME alone: its message is any text.
      const refused = error instanceof experimental_PluginRpcRefusal;
      const why = code !== undefined ? "refused before the act was asked" : refused ? String(error.message) : String((error as Error)?.name ?? "fault");
      say("warn", () => actLine(method, "held", about(), who(null), { held: code ?? (refused ? "invalid" : "error"), why }));
      throw error;
    }
    // The machine the act is SENT to: named on "asked" and, the same, on "ended" (never the machine the server
    // happens to hold when the act ends: a status read that failed meanwhile, or a changed setting, moves that).
    let host: string | null = null;
    let from = Date.now();
    let took = 0;
    let answered: { value: Value<Method>; endedAt: string };
    try {
      const value = await ask(method, extra, timeoutMs, signal, (hostId) => {
        host = hostId;
        from = Date.now(); // `ms` is the kernel's time: from the moment the act is sent
        say("info", () => actLine(method, "asked", about(), who(host)));
      });
      answered = { value, endedAt: actEnded() };
      took = Date.now() - from;
    } catch (error) {
      // Not sent: the machine or the deployment was not found: the kernel was not asked: a hold, with that read's code.
      if (host === null) say("warn", () => actLine(method, "held", about(), who(null), { held: codeOf(error) ?? "FAILED", why: "the machine that runs oats was not reached" }));
      else say("warn", () => actLine(method, "ended", about(), who(host), { result: codeOf(error) ?? "FAILED", ms: Date.now() - from }));
      throw error;
    } finally {
      after?.();
    }
    // The kernel answered: the act is done whatever becomes of its line (written outside the act's own try: reading
    // the answer for the line cannot turn a done act into a refusal).
    say(outcomeOf(method, answered.value).result === "ok" ? "info" : "warn", () => actLine(method, "ended", about(), who(host), { ...outcomeOf(method, answered.value), ms: took }));
    return answered;
  }

  /**
   * What the kernel printed for the roster, whole, as `oats status --json` printed it: the roster's
   * `root`, and by instance its own `row` and the row of its `agent` group (without the group's
   * instances), with the `at` of the read they are from. For a feature that draws more than `Agent`
   * holds: it reads them with a schema of its own, and nobody runs a second `oats status`.
   * While OATS cannot be read they are the LAST roster's, with `stale: true`; with no roster ever
   * read, the failure is the refusal, as for `agentOf`.
   */
  async function rowsOf(): Promise<{ at: string; stale: boolean; root: string; rows: ReadonlyMap<string, RawRow> }> {
    const now = await current();
    if (rawRows === null) {
      if (!now.ok) throw refusal({ code: now.code, message: now.message });
      throw refusal({ code: codes.hostUnreachable, message: "The OATS roster is being read again: try once more." });
    }
    return { ...rawRows, stale: !now.ok };
  }
  /** The same for one instance of that roster; an instance it does not name is refused. */
  async function rowOf(instance: string): Promise<{ at: string; stale: boolean; root: string } & RawRow> {
    const { at, stale, root, rows } = await rowsOf();
    const found = rows.get(instance);
    if (found === undefined) throw invalid(`"${instance}" is not an agent of this OATS deployment's ${stale ? "last" : "current"} snapshot`);
    return { at, stale, root, ...found };
  }

  /** One answer per page for all clients, reused for PAGE_TTL_MS; a failed read is not kept. */
  function page<Value>(name: string, load: (signal: AbortSignal) => Promise<Value>): Promise<Value> {
    const hit = pages.get(name);
    if (hit && Date.now() - hit.at < PAGE_TTL_MS) return hit.value as Promise<Value>;
    const value = load(lifetime.signal);
    pages.set(name, { at: Date.now(), value });
    value.catch(() => {
      if (pages.get(name)?.value === value) pages.delete(name);
    });
    return value;
  }
  /**
   * The kernel on the machine (`oats version --json`): its release, the version of its JSON answers
   * and the features it lists. One read for every feature and every client, reused like a page's
   * answer; a feature that depends on a kernel feature asks here and never runs it a second time.
   */
  const versionOf = (): Promise<Value<"version">> => page("version", (signal) => call("version", {}, HOST_TIMEOUT.read, signal));

  /** The thread an act left the agent in: the kernel's answer, else the row of the next snapshot. */
  async function threadOf(instance: string, named: string | null, act: string): Promise<string> {
    if (named !== null) return named;
    const next = await reread();
    const row = next.ok ? next.agents.find((agent) => agent.instance === instance) : undefined;
    if (row?.threadId) return row.threadId;
    throw refusal({ code: codes.noThread, message: `${act} ${instance}, but the kernel named no bb thread for it` });
  }

  // ---- what a client asks of the snapshot ----

  /** The snapshot for a client: the cached one, read again behind it when nobody refreshed it for a while. */
  async function clientSnapshot(): Promise<Snapshot> {
    clientSeenAt = Date.now();
    if (cached && Date.now() - lastStart > POLL_MS) rereadSoon();
    return current();
  }
  /** Retry: the pages' answers are dropped and OATS is read again now. */
  async function clientRefresh(): Promise<{ at: string }> {
    clientSeenAt = Date.now();
    pages.clear();
    return { at: (await reread()).at };
  }

  /** What makes the snapshot stale, and the service that polls. Called once the RPC handlers are registered. */
  function start(): void {
    // A client that reads `snapshot` with a watched query counts as connected until it leaves.
    bb.rpc.experimental_whileWatched("snapshot", (_read, signal) => {
      watchers += 1;
      signal.addEventListener("abort", () => (watchers -= 1), { once: true });
    });

    // ---- what makes the snapshot stale ----

    const offChanged = host.experimental_onSignal("changed", ({ hostId, payload }) => {
      if (target && hostId !== target.hostId) return;
      if (payload.reason !== "changed") watchAsserted = false; // a watcher error or a rescan: assert the watch again
      // The event path: each instance the watch named is read by itself; the status read follows as before.
      for (const file of payload.files) {
        const instance = agentOfFile(file);
        if (instance !== null) askEvents(instance);
      }
      rereadSoon();
    });
    const offWorkerExit = host.experimental_onWorkerExit(() => {
      watchAsserted = false;
      rereadSoon();
    });
    bb.events.on("thread.created", rereadSoon);
    bb.events.on("thread.deleted", rereadSoon);
    settings.onChange((next, prev) => {
      // Only what says WHERE OATS is read makes another roster: a setting the app alone reads
      // (`pages`) leaves the roster, and the last one kept while OATS cannot be read, as they are.
      if (next.deployment === prev.deployment && next.oatsBin === prev.oatsBin && next.host === prev.host) return;
      settingsGeneration += 1;
      // Another machine or deployment: what was read of the old one is not this one's roster, nor
      // its last one. Until the new one is read there is none: a client and an act wait for it.
      cached = null;
      comparable = "";
      patches.clear();
      statusAgents = null;
      eventsLine.length = 0;
      lastRoster = null;
      rawRows = null;
      target = null;
      watchAsserted = false;
      pages.clear();
      rereadSoon();
    });

    bb.background.service("snapshot", {
      async start(signal) {
        // Every start (a load, a reload, a bb restart) may have lost the host worker and its watch.
        watchAsserted = false;
        rereadSoon();
        while (!signal.aborted && !lifetime.signal.aborted) {
          await sleep(POLL_MS, AbortSignal.any([signal, lifetime.signal]));
          const connected = watchers > 0 || Date.now() - clientSeenAt < CLIENT_SEEN_MS;
          if (connected && !signal.aborted) rereadSoon();
        }
      },
    });

    bb.onDispose(() => {
      lifetime.abort();
      offChanged();
      offWorkerExit();
    });
  }

  return {
    /** Aborted when the plugin ends: an act is not ended by its caller going away, only by this. */
    signal: lifetime.signal,
    /** Where `oats` runs, once found; null before, and after a failed read. */
    target: () => target,
    call,
    act,
    page,
    reread,
    rereadSoon,
    rereadAfterAct,
    actEnded,
    agentOf,
    agentForAct,
    rowOf,
    rowsOf,
    versionOf,
    threadOf,
    clientSnapshot,
    clientRefresh,
    start,
  };
}
