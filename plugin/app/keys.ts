// The keys the app makes for the kernel. No bb or React import.

/**
 * A key the kernel uses to make an apply or a spawn idempotent: one per intent, reused when the
 * same intent is retried. `crypto.randomUUID` is absent on a plain-http origin (a phone on the
 * LAN), `getRandomValues` is not.
 */
export function newKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
