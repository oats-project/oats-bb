// What every feature's server module builds on: the settings, where `oats` runs (the machine and
// the deployment), the calls to the host entry, one cached snapshot for all clients and the realtime
// invalidation. It runs no process: every `oats` runs in the host entry (host.ts), on the machine
// that holds the homes, and the server never sends an argv. A feature's RPC handlers are in
// server/<feature>.ts; server.ts composes them.
import { experimental_PluginRpcRefusal, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { hostContract, hostSignals, REALTIME_CHANGED, type snapshot as snapshotSchema } from "../contract/index.js";
import { UNCONFIRMED_ISSUE } from "../contract/shared.js";
import { codes, type KernelError } from "../kernel/result.js";
import { withEvents, type EventsSaid } from "../model/events.js";
import type { Agent } from "../model/types.js";

/** What the kernel printed for one instance: its own row, and its agent group's row without the instances. */
export type RawRow = { readonly row: Readonly<Record<string, unknown>>; readonly agent: Readonly<Record<string, unknown>> };

/** The slow poll, while at least one client is connected. */
export const POLL_MS = 15_000;
/**
 * The pause between the end of one `oats status` and the start of the next: this, or as long as
 * the last status took to answer, whichever is longer (a read that failed is followed by this floor). So a change the watch reports reaches the screen
 * within 3 s on a kernel that answers in under a second (the UX standard, section 6), and a slow
 * kernel spends at most half its time on status, however many events arrive. (The first spec's
 * "never within 5 s of the last" gave way to this.)
 */
export const MIN_INTERVAL_MS = 1_000;
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

  let target: Target | null = null;
  /** Counts the settings changes, so that a discovery that read the old settings is not kept. */
  let settingsGeneration = 0;
  let watchAsserted = false;
  let cached: Snapshot | null = null;
  /** What the kernel printed behind the last roster read: its root, and each instance's rows; null before any. */
  let rawRows: { at: string; root: string; rows: ReadonlyMap<string, RawRow> } | null = null;
  /** The last roster read, kept while OATS cannot be read (it is `cached` while that is a roster). */
  let lastRoster: Extract<Snapshot, { ok: true }> | null = null;
  let comparable = "";
  let lastStart = 0;
  /** When the last read ended, and how long it took: what the pause before the next is counted from. */
  let lastEnd = 0;
  let lastTook = 0;
  let running: Promise<Snapshot> | null = null;
  let queued: Promise<Snapshot> | null = null;
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
  /** The instances whose events are being read now; `again`: a signal named it meanwhile, and one more read follows. */
  const eventsReads = new Map<string, { again: boolean }>();
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
    lastStart = Date.now();
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
      lastTook = 0;
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
    lastTook = next.ok ? lastEnd - lastStart : 0;
    if (changed && !lifetime.signal.aborted) bb.realtime.publish(REALTIME_CHANGED, { at: token(lastStart) });
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
   * Reads one instance's events and applies what they say to its row. Never two reads at once for
   * one instance: a signal that names it meanwhile makes one more read when this one ends.
   */
  async function readEvents(instance: string): Promise<void> {
    const reading = eventsReads.get(instance);
    if (reading !== undefined) {
      reading.again = true;
      return;
    }
    const mine = { again: false };
    eventsReads.set(instance, mine);
    try {
      do {
        mine.again = false;
        await readEventsOnce(instance);
      } while (mine.again && !lifetime.signal.aborted);
    } finally {
      eventsReads.delete(instance);
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
    if (shown === undefined || statusAgents === null) return dropped("the snapshot holds no such agent now");
    // The row is computed from what the STATUS read said of it, with this answer in the place of any
    // earlier one: never from a row that is patched already (an answer that says "stopped, then
    // started again" must take an earlier answer's "stopped" off).
    patches.set(instance, { said: answer.value, startedAt });
    const agents = withPatches(statusAgents, now.at);
    const next = agents.find((candidate) => candidate.instance === instance);
    const patchedSnapshot: Snapshot = { ...now, agents };
    const key = keyOf(patchedSnapshot, rawRows?.root ?? "", rawRows?.rows ?? null);
    if (next === undefined || key === comparable) return dropped(`its events say what is shown (read in ${took} ms)`);
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
   * asking meanwhile share it.
   */
  function reread(): Promise<Snapshot> {
    if (queued) return queued;
    const next = (async () => {
      if (running) await running;
      await sleep(Math.max(0, lastEnd + Math.max(MIN_INTERVAL_MS, lastTook) - Date.now()), lifetime.signal);
      queued = null;
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
  async function call<Method extends Verb>(method: Method, extra: Extra<Method>, timeoutMs: number, signal: AbortSignal): Promise<Value<Method>> {
    let where: Awaited<ReturnType<typeof base>>;
    let answer: Answer<unknown> | null = null;
    try {
      // Finding the machine and the deployment asks bb and the host daemon too: the same refusal.
      where = await base(signal);
      if (!("ok" in where)) {
        const input = { ...where.input, ...extra } as z.input<(typeof hostContract)[Method]["input"]>;
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
        if (instance !== null) void readEvents(instance);
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
    page,
    reread,
    rereadSoon,
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
