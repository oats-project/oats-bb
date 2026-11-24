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
 * The reads that owe one more read once their first answer is here (see `reread`): an event came
 * while it was on its way. One per read however many events came meanwhile, and for the window's
 * one shared copy of the read, whichever slot heard them. By the read's key: its method, and for
 * a read with an input (the panel's) the input with it.
 */
const owed = new Set<string>();

/**
 * What a live read does when the server publishes `oats/changed`: it reads again. And where the
 * read's FIRST answer is still on its way (`firstOnItsWay`), that answer is not taken as serving
 * the event: bb does not start again a read that has no answer yet, so `refetch` is handed the one
 * in flight, which the server answered from before the change. Once it is here the read is made
 * ONCE more, for all the events that came meanwhile. Every live read of the plugin goes through
 * this (`useRead` here; the panel's own read, app/panel/read.ts).
 * (A read that fails says so in the read's own state, as every read does: both ends go on.)
 */
export function reread(key: string, firstOnItsWay: boolean, refetch: () => Promise<unknown>): void {
  if (!firstOnItsWay) {
    void refetch();
    return;
  }
  if (owed.has(key)) return;
  owed.add(key);
  const again = () => {
    owed.delete(key);
    void refetch();
  };
  attempt(refetch).then(again, again);
}

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
  /**
   * Whether the read's FIRST answer is on its way: bb is fetching it and it has none yet. Set as the
   * read is drawn (not in an effect, which runs a moment later): an event that comes between a
   * draw and its effect would else see the read as it was before. What is left is the moment
   * between bb's notice of an answer and the draw it causes: an event in it sees the read from
   * before that answer, which costs one read too many (the answer had just come) or, for a read
   * whose first answer FAILED and that an event restarts, is handed that restarted read once.
   */
  const first = useRef(false);
  first.current = query.isFetching && query.data === undefined;
  useEffect(() => {
    refetch.current = query.refetch;
  });

  useRealtime(REALTIME_CHANGED, (payload) => {
    if (!enabled || !live) return;
    const token = tokenOf(payload);
    if (token !== undefined) {
      if (acted.get(method) === token) return;
      acted.set(method, token);
    }
    reread(method, first.current, () => refetch.current());
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
