// What every feature's contract module builds from. A feature's own schemas, RPC verbs and host
// verbs are in contract/<feature>.ts; contract/index.ts composes them.
import { z } from "zod";

/** The kernel's instance-name rule, as the plugin enforces it before any process starts. */
export const instanceName = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
/** An idempotency key: one per intent, made by the app. */
export const key = z.string().min(8).max(128);
/** A kernel plan, as the lines a confirmation shows, with the revision an apply names. */
export const plan = z.object({ revision: z.string(), lines: z.array(z.string()), instance: z.string().nullable() });

// ---- The host contract: every method that runs `oats` answers
// `{ ok: true, value } | { ok: false, error: { code, message } }` and never throws for a kernel
// refusal or a failed process: `code` is the kernel's (`E_*`) or one of the plugin's own
// (kernel/result.ts), and `message` is the kernel's, unchanged.

/** Where the host entry runs `oats`: the deployment directory (its cwd) and the binary ("" = `oats` on PATH). */
export const hostBase = { deployment: z.string().min(1), oatsBin: z.string() };
/** A refusal or a failure of `oats`; `unconfirmed` only where the kernel set its marker (kernel/result.ts `KernelError`). */
const kernelError = z.object({ code: z.string(), message: z.string(), unconfirmed: z.literal(true).optional() });
/**
 * How the kernel's marker reaches the app. bb's RPC refusal carries a code, a message and `issues`:
 * the server adds this one issue to the refusal of an error the kernel marked unconfirmed
 * (server/core.ts `refusal`), and a place that needs the marker reads it with `isUnconfirmed`. The
 * refusal's message stays `<code>: <message>`.
 */
export const UNCONFIRMED_ISSUE = { message: "unconfirmed", path: ["details", "unconfirmed"] } as const;
/**
 * Whether a failed call is the refusal of an error the kernel marked unconfirmed: the one reader of
 * the marker, for every place of the app that needs it. Nothing draws a refusal's issues: no place
 * of the plugin reads them but this, and bb's app (0.50.1) only copies them onto the call's error.
 */
export function isUnconfirmed(cause: unknown): boolean {
  const issues = typeof cause === "object" && cause !== null ? (cause as { issues?: unknown }).issues : undefined;
  return (
    Array.isArray(issues) &&
    issues.some((issue: unknown) => {
      if (typeof issue !== "object" || issue === null) return false;
      const { message, path } = issue as { message?: unknown; path?: unknown };
      return message === UNCONFIRMED_ISSUE.message && Array.isArray(path) && path.length === UNCONFIRMED_ISSUE.path.length && UNCONFIRMED_ISSUE.path.every((part, at) => path[at] === part);
    })
  );
}
export const answer = <Value extends z.ZodType>(value: Value) =>
  z.union([
    z.object({ ok: z.literal(true), value }),
    z.object({ ok: z.literal(false), error: kernelError }),
  ]);
export const hostRead = z.object(hostBase).strict();
export const hostInstance = z.object({ ...hostBase, instance: instanceName }).strict();
export const hostApply = z.object({ ...hostBase, instance: instanceName, revision: z.string(), key }).strict();
/** `home` is the home the kernel's status named for the instance; never a caller's. */
export const hostHome = z.object({ ...hostBase, home: z.string().min(1) }).strict();
