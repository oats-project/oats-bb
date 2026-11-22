// Agents the kernel no longer has, though the roster on screen still lists them: the kernel
// refused an act on one as an instance it does not know. The row says so until the next roster is
// read, which either drops the row or shows that the agent is there after all.
import { useSyncExternalStore } from "react";
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
let gone: ReadonlySet<string> = NONE;
/** The roster the marks belong to: the time it was read. */
let roster: string | null = null;
const listeners = new Set<() => void>();
const publish = (next: ReadonlySet<string>) => {
  gone = next;
  for (const listener of listeners) listener();
};

/** The kernel refused `instance` as one it does not know. */
export function markGone(instance: string): void {
  if (!gone.has(instance)) publish(new Set([...gone, instance]));
}

/** The marks for the roster read at `at`: a roster read at another time starts with none. */
export function useGone(at: string | null): ReadonlySet<string> {
  if (at !== roster) {
    roster = at;
    gone = NONE; // read during render: the new roster's rows are drawn without the old marks
  }
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => gone,
  );
}

onWindowReset(() => {
  roster = null;
  gone = NONE;
});
