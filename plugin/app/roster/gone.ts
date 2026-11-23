// Agents the kernel no longer has, though the roster on screen still lists them: the kernel
// refused an act on one as an instance it does not know. The row says so until the next roster is
// read, which either drops the row or shows that the agent is there after all.
import { useEffect, useSyncExternalStore } from "react";
import { onWindowReset } from "../store";

/** What a row says in its state's place once the kernel has refused its agent as one it does not know; its mark is then the one of an agent that does not run. */
export const GONE_WORD = "Not in OATS any more";
export const GONE_MARK = "stopped" as const;

/** The kernel's code when a name is no instance's (`no instance "<name>" under <roots>`). */
export const UNKNOWN_INSTANCE = "E_SESSION_UNKNOWN";

/**
 * Whether the refusal of a stop PLAN or a retire PLAN says the kernel has no such agent: by its
 * code alone, E_SESSION_UNKNOWN, which the kernel documents for it (docs/desktop-cli-api.md) and
 * which a plan can only get from resolving the name (`no instance "<name>" under <roots>`,
 * recorded in test/fixtures/lifecycle/gone.json). Never by its words.
 *
 * Nothing else marks an agent gone. A start, a restart and an apply can be refused with the same
 * code for a session whose state cannot be established, and a start on a retired home answers a
 * code shared with other failures (E_WORK_INSPECTION_FAILED): those are shown as the kernel's
 * refusal, and the roster, read again right after every act, drops the row of an agent that is
 * no longer there.
 */
export const planSaysGone = (code: string | null): boolean => code === UNKNOWN_INSTANCE;

const NONE: ReadonlySet<string> = new Set();
/**
 * The marks, keyed by the roster they belong to (the time it was read): a roster read at another
 * time has none. The key is in the store, so a reader takes the marks of ITS roster and nothing is
 * reset while rendering.
 */
let marks: { at: string | null; names: ReadonlySet<string> } = { at: null, names: NONE };
/** The roster on screen: the one a mark made now belongs to. */
let shownAt: string | null = null;
const listeners = new Set<() => void>();

/** The kernel refused `instance` as one it does not know. */
export function markGone(instance: string): void {
  const names = marks.at === shownAt ? marks.names : NONE;
  if (names.has(instance)) return;
  marks = { at: shownAt, names: new Set([...names, instance]) };
  for (const listener of listeners) listener();
}

/** The marks for the roster read at `at`: a roster read at another time starts with none. */
export function useGone(at: string | null): ReadonlySet<string> {
  useEffect(() => {
    shownAt = at;
  }, [at]);
  const all = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => marks,
  );
  return all.at === at ? all.names : NONE;
}

onWindowReset(() => {
  marks = { at: null, names: NONE };
  shownAt = null;
});
