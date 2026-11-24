// What bb says of the threads the roster's rows name and bb's own sidebar list does not hold:
// archived, or not there at all (deleted). bb's sidebar lists its ACTIVE threads only, so a thread
// that is archived and one that was deleted look the same there; this asks bb itself, by id, for
// the archived ones (`threads.list`, one request for up to 200 ids). One copy per app window,
// whatever number of places ask.
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import type { Agent, BbThread, StartFailure, ThreadWhere } from "../../model/types";
import { attempt, onWindowReset } from "../store";

/** bb's answer for an id that was asked: it has the thread archived, or it has no archived thread of that id. */
export type Answer = "archived" | "not-archived";

const NONE: ReadonlyMap<string, Answer> = new Map();
let answers: ReadonlyMap<string, Answer> = NONE;
/** What was last asked (the ids and the moment's token): asked once, whoever asks. */
let asked = "";
const listeners = new Set<() => void>();
const publish = (next: ReadonlyMap<string, Answer>) => {
  answers = next;
  for (const listener of [...listeners]) listener();
};

onWindowReset(() => {
  answers = NONE;
  asked = "";
  listeners.clear();
});

/** bb takes at most 200 ids in one request. */
const PAGE = 200;

/**
 * bb's answer for each of `ids`, by id; an id with no entry was not answered yet (or bb could not
 * say). Asked again whenever the ids or `token` change: `token` is what the caller knows of the
 * moment (the roster read, the minute), since bb tells nobody that an archived thread was deleted.
 */
export function useArchived(ids: readonly string[], token: string): ReadonlyMap<string, Answer> {
  const sdk = useSdk();
  const sorted = [...new Set(ids)].sort();
  const idsKey = sorted.join(" ");
  useEffect(() => {
    const key = `${token}\n${idsKey}`;
    if (key === asked) return;
    asked = key;
    const wanted = idsKey === "" ? [] : idsKey.split(" ");
    if (wanted.length === 0) {
      if (answers.size > 0) publish(NONE);
      return;
    }
    const pages: string[][] = [];
    for (let index = 0; index < wanted.length; index += PAGE) pages.push(wanted.slice(index, index + PAGE));
    // Only archived threads, hidden ones included: an id bb answers is archived; one it leaves out
    // is unknown to bb, deleted, or not archived.
    Promise.all(pages.map((page) => attempt(() => sdk.threads.list({ threadIds: page, archived: true, includeHidden: true })))).then(
      (lists) => {
        if (asked !== key) return; // a newer question is out: its answer is the one to keep
        const found = new Set(lists.flat().filter((thread) => thread.archivedAt !== null).map((thread) => thread.id));
        publish(new Map(wanted.map((id) => [id, found.has(id) ? "archived" : "not-archived"] as const)));
      },
      () => {
        // bb could not say: nothing is known of these ids, and nothing is claimed. Asked again at the next change.
        if (asked !== key) return;
        asked = "";
        publish(NONE);
      },
    );
  }, [sdk, idsKey, token]);
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => answers,
  );
}

/**
 * Whether a thread FAILED AT ITS START, from bb's answers for its events: bb recorded an error
 * (`system/error`) and never the start of a turn (`turn/started`). The thread's record and bb's
 * sidebar say "error" alike for such a thread and for one whose later turn failed; only its events
 * tell them apart. null: a turn started, or bb recorded no error. Pure.
 * (The error's own fields are under the event's `data`.)
 */
export function startFailureOf(turns: readonly unknown[], errors: readonly { seq?: number; data?: unknown }[]): StartFailure | null {
  if (turns.length > 0 || errors.length === 0) return null;
  const last = errors.reduce((a, b) => ((b.seq ?? 0) >= (a.seq ?? 0) ? b : a));
  const data = (typeof last.data === "object" && last.data !== null ? last.data : {}) as { message?: unknown; detail?: unknown };
  return { message: typeof data.message === "string" ? data.message : "", detail: typeof data.detail === "string" && data.detail !== "" ? data.detail : null };
}

/** The two types of event the rule reads, each in a read of its own that asks bb for ONE event. */
export const STARTED = "turn/started";
export const ERRORED = "system/error";

type Sdk = ReturnType<typeof useSdk>;
/**
 * The two reads of the rule for one thread. ALWAYS a read by type, never the thread's whole log:
 * the log holds the thread's environment (`provider.env-resolved`: its variables' values), which
 * must not come into the page. Each read is of one type and one event: whether a turn ever
 * started, and bb's last error.
 */
const readStart = (sdk: Sdk, threadId: string) =>
  Promise.all([
    attempt(() => sdk.threads.events.list({ threadId, types: [STARTED], order: "asc", limit: "1" })),
    attempt(() => sdk.threads.events.list({ threadId, types: [ERRORED], order: "desc", limit: "1" })),
  ]);

/** How long a place waits for a thread it just made to leave its start, and how often it asks bb meanwhile. */
export const START_WAIT_MS = 10_000;
const START_ASK_MS = 500;

/**
 * For the place that just made a thread (the New agent form): whether the thread FAILED AT ITS
 * START, once bb's own status of it is no longer one of a thread that has not begun ("starting",
 * or "pending": in line to start), or after `START_WAIT_MS`. null: it did not (it runs, it is at
 * rest, or it failed later), bb could not say, or it had not left its start in that time: the
 * place then says what it says without this.
 */
export function startOutcome(sdk: Sdk, threadId: string): Promise<StartFailure | null> {
  let over = false;
  const asking = async (): Promise<StartFailure | null> => {
    try {
      while (!over) {
        const { status } = await attempt(() => sdk.threads.get({ threadId }));
        if (status !== "starting" && status !== "pending") {
          if (status !== "error") return null;
          const [turns, errors] = await readStart(sdk, threadId);
          return startFailureOf(turns, errors);
        }
        await new Promise((resolve) => setTimeout(resolve, START_ASK_MS));
      }
      return null;
    } catch {
      // bb could not say: nothing is claimed of the thread.
      return null;
    }
  };
  // The wait ends BY THE CLOCK, whatever bb does: an answer that never comes (bb's connection gone)
  // must not hold the place that waits. After `START_WAIT_MS`: null, and no more is asked.
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      over = true;
      resolve(null);
    }, START_WAIT_MS);
    void asking().then((answer) => {
      over = true;
      clearTimeout(timer);
      resolve(answer);
    });
  });
}

/** An id with a failure: it failed at its start; with null: bb answered, and it did not; with no entry: not answered. */
const NO_FAILURES: ReadonlyMap<string, StartFailure | null> = new Map();
let failures: ReadonlyMap<string, StartFailure | null> = NO_FAILURES;
/** The threads bb answered a started turn for: that never changes, so they are not asked again in this window. */
const started = new Set<string>();
let failuresAsked = "";
const failureListeners = new Set<() => void>();
onWindowReset(() => {
  failures = NO_FAILURES;
  started.clear();
  failuresAsked = "";
  failureListeners.clear();
});

/**
 * Whether each of `ids` (threads bb lists in "error") failed at its start, by id. Asked again
 * whenever the ids or `token` change, as `useArchived` is: a thread that failed at its start may
 * be started since. One that has started a turn is not asked again.
 */
export function useStartFailures(ids: readonly string[], token: string): ReadonlyMap<string, StartFailure | null> {
  const sdk = useSdk();
  const idsKey = [...new Set(ids)].sort().join(" ");
  useEffect(() => {
    const key = `${token}\n${idsKey}`;
    if (key === failuresAsked) return;
    failuresAsked = key;
    const wanted = idsKey === "" ? [] : idsKey.split(" ");
    const publish = (next: ReadonlyMap<string, StartFailure | null>) => {
      if (next.size === 0 && failures.size === 0) return;
      failures = next;
      for (const listener of [...failureListeners]) listener();
    };
    if (wanted.length === 0) return publish(NO_FAILURES);
    const ask = (threadId: string) =>
      started.has(threadId)
        ? Promise.resolve(null)
        : readStart(sdk, threadId).then(([turns, errors]) => {
            if (turns.length > 0) started.add(threadId);
            return startFailureOf(turns, errors);
          });
    // Each thread by itself: for one bb cannot answer for, what bb last said of it stands (nothing, if it never answered), and it is asked again at the next change.
    Promise.allSettled(wanted.map(ask)).then((answers) => {
      if (failuresAsked !== key) return; // a newer question is out
      const next = new Map<string, StartFailure | null>();
      answers.forEach((answer, index) => {
        const id = wanted[index]!;
        if (answer.status === "fulfilled") next.set(id, answer.value);
        // bb could not say THIS time: what it last said of the thread stands (a thread it said
        // failed at its start does not go back to "session lost" for a read that failed), and it is asked again.
        else if (failures.has(id)) next.set(id, failures.get(id)!);
      });
      if (answers.some((answer) => answer.status === "rejected")) failuresAsked = "";
      publish(next);
    });
  }, [sdk, idsKey, token]);
  return useSyncExternalStore(
    (listener) => {
      failureListeners.add(listener);
      return () => failureListeners.delete(listener);
    },
    () => failures,
  );
}

/**
 * bb's threads with what bb's events say of the ones in "error" that an agent's row names
 * (`BbThread.startFailure`), for `useOats()`: every place then reads ONE fact (the state, the
 * line, the acts, the home). Until bb has answered, a thread is as bb's sidebar gives it (no
 * `startFailure` at all), and its row says what it says without this, and invites no message:
 * it may be a thread that never started. Where bb cannot answer, what it last said of the thread
 * stands (nothing, if it never answered). Asked again at each roster read
 * (`at`) and each minute.
 */
export function useStartedThreads<T extends BbThread>(agents: readonly Agent[] | undefined, threads: readonly T[], at: string): readonly T[] {
  const minuteOfWindow = useSyncExternalStore(onMinute, minuteNow);
  const ids = useMemo(() => {
    const named = new Set((agents ?? NO_ONE).flatMap((agent) => (agent.backend === "tmux" || agent.threadId === null ? [] : [agent.threadId])));
    return threads.filter((thread) => thread.status === "error" && named.has(thread.id)).map((thread) => thread.id);
  }, [agents, threads]);
  const answered = useStartFailures(ids, `${at} ${minuteOfWindow}`);
  return useMemo(() => {
    // bb's answer rides on the thread in its THREE values (model/types.ts `BbThread.startFailure`):
    // the failure, `null` (answered: a turn started), or nothing at all while bb has not answered.
    if (!threads.some((thread) => thread.status === "error" && answered.has(thread.id))) return threads;
    return threads.map((thread) => (thread.status === "error" && answered.has(thread.id) ? { ...thread, startFailure: answered.get(thread.id) ?? null } : thread));
  }, [threads, answered]);
}

const NO_ONE: readonly Agent[] = [];

// The minute, ONE for the app window: every place that reads the roster asks with the same token,
// so bb is asked once whatever number of places are drawn (each place's own clock would give each
// its own minute for most of every minute, and one request per place). One interval, while a place listens.
let minute = Math.floor(Date.now() / 60_000);
const minuteListeners = new Set<() => void>();
let minuteTimer: ReturnType<typeof setInterval> | null = null;
function onMinute(listener: () => void): () => void {
  minuteListeners.add(listener);
  minuteTimer ??= setInterval(() => {
    const now = Math.floor(Date.now() / 60_000);
    if (now === minute) return;
    minute = now;
    for (const each of [...minuteListeners]) each();
  }, 5_000);
  return () => {
    minuteListeners.delete(listener);
    if (minuteListeners.size === 0 && minuteTimer !== null) {
      clearInterval(minuteTimer);
      minuteTimer = null;
    }
  };
}
const minuteNow = () => minute;
onWindowReset(() => {
  minute = Math.floor(Date.now() / 60_000);
});

/**
 * What bb says of the thread each agent's row names, for `useOats()` (`Oats.whereOf`), which this
 * feature's reasons read (say.ts): a function of the roster's `agents`, bb's `listed` threads by id
 * and bb's answer for the ids it does not list. bb is asked again at each roster read (`at`) and
 * each minute: it tells nobody when an archived thread is deleted.
 * - an agent on tmux, or a row that names no thread: "none";
 * - a thread bb lists: "open" ("archived" where the list itself says so);
 * - one it does not list: "archived" or "missing" by bb's answer, "unknown" until it has answered.
 */
export function useThreadWhere(agents: readonly Agent[] | undefined, listed: ReadonlyMap<string, { isArchived: boolean }>, at: string): (agent: Agent) => ThreadWhere {
  const minuteOfWindow = useSyncExternalStore(onMinute, minuteNow);
  const roster = agents ?? NO_ONE;
  const ids = useMemo(() => roster.flatMap((agent) => (agent.backend === "tmux" || agent.threadId === null || listed.has(agent.threadId) ? [] : [agent.threadId])), [roster, listed]);
  const archived = useArchived(ids, `${at} ${minuteOfWindow}`);
  return useMemo(
    () => (agent: Agent) => {
      if (agent.backend === "tmux" || agent.threadId === null) return "none";
      const thread = listed.get(agent.threadId);
      if (thread !== undefined) return thread.isArchived ? "archived" : "open";
      const answer = archived.get(agent.threadId);
      return answer === undefined ? "unknown" : answer === "archived" ? "archived" : "missing";
    },
    [listed, archived],
  );
}
