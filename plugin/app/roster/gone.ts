// Agents the kernel no longer has, though the roster on screen still lists them: the kernel
// refused an act on one as an instance it does not know. The row says so until the next roster is
// read, which either drops the row or shows that the agent is there after all.
import { useSyncExternalStore } from "react";
import { onWindowReset } from "../store";

/** What a row says in its state's place once the kernel has refused its agent as one it does not know; its mark is then the one of an agent that does not run. */
export const GONE_WORD = "Not in OATS any more";
export const GONE_MARK = "stopped" as const;

/** The kernel's code for an instance it has no home for (`no instance named "<name>"`). */
export const UNKNOWN_INSTANCE = "E_SESSION_UNKNOWN";

/**
 * Whether a refusal says the kernel has no such agent. A plan (stop, retire) is refused with this
 * code only for that. Start and restart use the same code for a session whose state cannot be
 * established too, so for those (`plan: false`) the kernel's message must say it: "no instance
 * named …", or "… is not an OATS instance home".
 */
export function saysGone(code: string | null, message: string, { plan }: { plan: boolean }): boolean {
  if (code !== UNKNOWN_INSTANCE) return false;
  return plan || /\bno instance named\b|\bis not an (OATS )?instance home\b/.test(message);
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
