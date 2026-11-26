// Which option of a question a person sent, in this app window, and which is on its way. "Sent."
// is a MARK, never the guard that an answer may go (that is asked of the server at the press:
// app/home/send.ts, and the question read again there); "on its way" is what makes one press one
// send. By
// the agent and the question's occurrence (its id and when it was asked): a question the agent
// clears and asks again is another, with nothing sent. Both places that draw a question (the
// board, the home's card) read it, so that an option sent in one is marked in the other.
import { useSyncExternalStore } from "react";
import { onWindowReset } from "../store";

const sent = new Map<string, number>();
/** What the last press of an occurrence was refused with: said under its options wherever, and however often, they are drawn (a refusal that lands while the options were drawn anew is not lost). */
const refusals = new Map<string, string>();
/** The occurrences an answer is ON ITS WAY for: one press is one send, wherever the question is drawn and however often its options are mounted anew. */
const going = new Set<string>();
const listeners = new Set<() => void>();
const keyOf = (instance: string, occurrence: string): string => `${instance} ${occurrence}`;

/** Notes that option `index` of that occurrence was sent. */
export function noteSent(instance: string, occurrence: string, index: number): void {
  sent.set(keyOf(instance, occurrence), index);
  going.delete(keyOf(instance, occurrence));
  for (const listener of listeners) listener();
}

/**
 * Takes the one send of that occurrence: true for the press that may send, false while another is
 * on its way or one was sent. Held HERE, not in the component that was pressed: the options of a
 * question are mounted anew by ‹ ›, by a tab press and by the home's card, inside one send's time.
 */
export function takeSend(instance: string, occurrence: string): boolean {
  const key = keyOf(instance, occurrence);
  if (going.has(key) || sent.has(key)) return false;
  going.add(key);
  refusals.delete(key); // a new press: what the last one was refused with is no longer what is said
  for (const listener of listeners) listener();
  return true;
}
/** The send of that occurrence ended without sending, and why (a refusal, a failure): it may be pressed again. */
export function dropSend(instance: string, occurrence: string, why: string): void {
  going.delete(keyOf(instance, occurrence));
  refusals.set(keyOf(instance, occurrence), why);
  for (const listener of listeners) listener();
}
/** What the last press of that occurrence was refused with, in this window, or null. */
export function useRefused(instance: string, occurrence: string): string | null {
  const key = keyOf(instance, occurrence);
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => refusals.get(key) ?? null,
    () => null,
  );
}
/** Whether an answer of that occurrence is on its way, in this window. */
export function useGoing(instance: string, occurrence: string): boolean {
  const key = keyOf(instance, occurrence);
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => going.has(key),
    () => false,
  );
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
  going.clear();
  refusals.clear();
  for (const listener of listeners) listener();
});
