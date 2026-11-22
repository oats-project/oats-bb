// Agents the kernel no longer has, though the roster on screen still lists them: the kernel
// refused an act on one as an instance it does not know. The row says so until the next roster is
// read, which either drops the row or shows that the agent is there after all.
import { useSyncExternalStore } from "react";
import { onWindowReset } from "../store";

/** The kernel's code for an instance it has no home for (`no instance named "<name>"`). */
export const UNKNOWN_INSTANCE = "E_SESSION_UNKNOWN";

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
