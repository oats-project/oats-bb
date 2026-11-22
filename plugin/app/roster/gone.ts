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
 * Whether a refusal says the kernel has no such agent. The kernel says it in two ways, as recorded
 * from it (test/fixtures/lifecycle/gone.json; awebai/oats lib/instance-address.mjs and
 * lib/core.mjs at 95c7b43b3):
 * - a stop or a retire, plan or apply, resolves the name first: E_SESSION_UNKNOWN,
 *   `no instance "<name>" under <roots>`. The code alone is not enough: for a session it also
 *   means one whose state cannot be established.
 * - a start or a restart is given the home. For a home that was retired the kernel answers
 *   `directory instance home was removed or exchanged: <home>; …` (E_WORK_INSPECTION_FAILED, as
 *   recorded); for a directory that never was one, `<home> is not an OATS instance home (no
 *   instance.json); nothing was started` (E_RUNTIME_ENDPOINT_UNKNOWN, lib/core.mjs). The message is
 *   what says it, whatever the code.
 */
export function saysGone(code: string | null, message: string): boolean {
  if (/\binstance home was removed or exchanged\b|\bis not an OATS instance home\b/.test(message)) return true;
  return code === UNKNOWN_INSTANCE && /\bno instance (named )?"/.test(message);
}

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
