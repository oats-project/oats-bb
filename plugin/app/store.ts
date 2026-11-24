// The plugin's reads, as every slot takes them: bb's watched RPC reads (one shared copy per app
// window, whatever number of slots ask), reread when the server publishes `oats/changed`.
//
// `snapshot` must be a watched read: the server polls OATS only while a client watches it
// (`bb.rpc.experimental_whileWatched`).
import { useEffect, useRef } from "react";
import { experimental_useRpcQuery as useRpcQuery, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { PluginRpcClient, PluginRpcResult, StandardSchemaV1InferInput } from "@get-bb/plugin-sdk/app";
import { REALTIME_CHANGED, rpcContract } from "../contract";

export type Contract = typeof rpcContract;
export type Rpc = PluginRpcClient<Contract>;
/** The verbs a slot can read with `useRead`: every one of the contract that takes no input, but `refresh`, which asks OATS to be read again. */
export type ReadMethod = Exclude<{ [Method in keyof Contract]: StandardSchemaV1InferInput<Contract[Method]["input"]> extends null ? Method : never }[keyof Contract], "refresh">;
export type Result<Method extends keyof Contract> = PluginRpcResult<Contract[Method]>;

export type Read<T> =
  | { status: "loading"; data: undefined; error: null }
  | { status: "ready"; data: T; error: null }
  /** The last attempt failed. `data` is what an earlier attempt read, if any. */
  | { status: "error"; data: T | undefined; error: string };

/** What a failed call says, unchanged: the kernel's code and message come through the server. */
export function errorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message !== "") return cause.message;
  if (typeof cause === "string" && cause !== "") return cause;
  return "The OATS plugin's server did not answer.";
}

/**
 * A call made from inside a promise, so a client that throws at the call itself is a rejection
 * like any other failure.
 */
export function attempt<T>(call: () => Promise<T>): Promise<T> {
  return Promise.resolve().then(call);
}

/**
 * The invalidation each read last acted on. Every mounted slot hears the same `oats/changed`
 * event; the first to hear it rereads the shared copy, the others find it already asked for.
 */
const acted = new Map<ReadMethod, string>();

/**
 * The reads that owe one more read once their first answer is here (see `useRead`): an event came
 * while it was on its way. One per read however many events came meanwhile, and for the window's
 * one shared copy of the read, whichever slot heard them.
 */
const owed = new Set<ReadMethod>();

/** What a feature keeps for the length of an app window, outside React: forgotten between tests. */
const windowState: (() => void)[] = [() => acted.clear(), () => owed.clear()];

/** A feature with state of its own for the app window names how to forget it. */
export function onWindowReset(forget: () => void): void {
  windowState.push(forget);
}

/** For tests: a new app window has acted on nothing and holds no feature's state. */
export function resetWindow(): void {
  for (const forget of windowState) forget();
}

function tokenOf(payload: unknown): string | undefined {
  if (typeof payload === "object" && payload !== null && "at" in payload) {
    const at = (payload as { at: unknown }).at;
    if (typeof at === "string") return at;
  }
  return undefined;
}

/**
 * One of the plugin's reads, kept fresh: loaded on first use and reread when the server publishes
 * `oats/changed`. bb itself rereads every plugin read when its realtime connection comes back.
 * `live: false` reads once and leaves the rereading to the slots that show the read itself.
 *
 * AN EVENT THAT ARRIVES WHILE THE FIRST ANSWER IS ON ITS WAY is not served by that answer. A read
 * that has no answer yet is not started again by bb: the event's reread is handed the one in
 * flight, and the server made THAT answer before it published the event (from its cache, from
 * before the change). So once the first answer is here, the read is made ONCE more: that one
 * starts after the event, and is given what the event announced. Without it a window that loads
 * while the server reads a change holds the roster from before the change until some other agent
 * changes. However many events come while the first answer is on its way, ONE read is owed, not
 * one each. (A read that already has an answer needs none of this: for a new event bb drops the
 * reread in flight and starts another, so there is never more than one on its way and the last
 * event's is the one that answers. test/app/window-loads.test.tsx holds all of it.) It costs one
 * more answer from the server's cache, and no `oats status`.
 */
export function useRead<Method extends ReadMethod>(
  method: Method,
  options: { enabled?: boolean; live?: boolean } = {},
): Read<Result<Method>> & { retry(): void } {
  const enabled = options.enabled ?? true;
  const live = options.live ?? true;
  const rpc = useRpc<Contract>();
  const query = useRpcQuery({ contract: rpcContract, method, input: null, enabled });
  const refetch = useRef(query.refetch);
  /** Whether the read's FIRST answer is on its way: bb is fetching it and it has none yet. */
  const first = useRef(query.isFetching && query.data === undefined);
  useEffect(() => {
    refetch.current = query.refetch;
    first.current = query.isFetching && query.data === undefined;
  });

  useRealtime(REALTIME_CHANGED, (payload) => {
    if (!enabled || !live) return;
    const token = tokenOf(payload);
    if (token !== undefined) {
      if (acted.get(method) === token) return;
      acted.set(method, token);
    }
    if (!first.current) {
      void refetch.current();
      return;
    }
    // The first answer is on its way, made from before this event: when it is here, read again,
    // once for all the events that came meanwhile.
    // (A read that fails says so in the read's own state, as every read does: both ends go on.)
    if (owed.has(method)) return;
    owed.add(method);
    const again = () => {
      owed.delete(method);
      void refetch.current();
    };
    attempt(() => refetch.current()).then(again, again);
  });

  const data = query.data as Result<Method> | undefined;
  const retry = () => {
    // Retry asks the server to reread OATS now, then reads what it has.
    const reread = () => void refetch.current();
    attempt(() => rpc.call("refresh", null)).then(reread, reread);
  };
  if (query.error !== null) return { status: "error", data, error: errorMessage(query.error), retry };
  if (data === undefined) return { status: "loading", data: undefined, error: null, retry };
  return { status: "ready", data, error: null, retry };
}
