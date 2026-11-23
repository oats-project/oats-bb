// What bb says of the threads the roster's rows name and bb's own sidebar list does not hold:
// archived, or not there at all (deleted). bb's sidebar lists its ACTIVE threads only, so a thread
// that is archived and one that was deleted look the same there; this asks bb itself, by id, for
// the archived ones (`threads.list`, one request for up to 200 ids). One copy per app window,
// whatever number of places ask.
import { useEffect, useSyncExternalStore } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
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
