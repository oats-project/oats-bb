// Which option of a question a person sent, in this app window: a MARK, never a guard (the guard
// is asked of the server at the press: app/home/send.ts, and the question read again there). By
// the agent and the question's occurrence (its id and when it was asked): a question the agent
// clears and asks again is another, with nothing sent. Both places that draw a question (the
// board, the home's card) read it, so that an option sent in one is marked in the other.
import { useSyncExternalStore } from "react";
import { onWindowReset } from "../store";

const sent = new Map<string, number>();
const listeners = new Set<() => void>();
const keyOf = (instance: string, occurrence: string): string => `${instance} ${occurrence}`;

/** Notes that option `index` of that occurrence was sent. */
export function noteSent(instance: string, occurrence: string, index: number): void {
  sent.set(keyOf(instance, occurrence), index);
  for (const listener of listeners) listener();
}

/** The option sent for that occurrence in this window (0-based), or null. */
export function useSent(instance: string, occurrence: string): number | null {
  const key = keyOf(instance, occurrence);
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => sent.get(key) ?? null,
    () => null,
  );
}

onWindowReset(() => {
  sent.clear();
  for (const listener of listeners) listener();
});
