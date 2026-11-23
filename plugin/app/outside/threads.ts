// What bb says of the threads the roster's rows name and bb's own sidebar list does not hold:
// archived, or not there at all (deleted). bb's sidebar lists its ACTIVE threads only, so a thread
// that is archived and one that was deleted look the same there; this asks bb itself, by id, for
// the archived ones (`threads.list`, one request for up to 200 ids). One copy per app window,
// whatever number of places ask.
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import type { Agent, ThreadWhere } from "../../model/types";
import { useNow } from "../roster/now";
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

const NO_ONE: readonly Agent[] = [];

/**
 * What bb says of the thread each agent's row names, for `useOats()`, which gives it to the one
 * state function and to `view()`: a function of the roster's `agents`, bb's `listed` threads by id
 * and bb's answer for the ids it does not list. bb is asked again at each roster read (`at`) and
 * each minute: it tells nobody when an archived thread is deleted.
 * - an agent on tmux, or a row that names no thread: "none";
 * - a thread bb lists: "open" ("archived" where the list itself says so);
 * - one it does not list: "archived" or "missing" by bb's answer, "unknown" until it has answered.
 */
export function useThreadWhere(agents: readonly Agent[] | undefined, listed: ReadonlyMap<string, { isArchived: boolean }>, at: string): (agent: Agent) => ThreadWhere {
  const minute = Math.floor(useNow(60_000) / 60_000);
  const roster = agents ?? NO_ONE;
  const ids = useMemo(() => roster.flatMap((agent) => (agent.backend === "tmux" || agent.threadId === null || listed.has(agent.threadId) ? [] : [agent.threadId])), [roster, listed]);
  const archived = useArchived(ids, `${at} ${minute}`);
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
