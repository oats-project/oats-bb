// The panel's reads of one instance (app/store.ts says how the plugin's reads work): the facts of
// the roster's row, kept fresh, and the reads that run a command of their own. Such a read runs
// once, when its part is first shown for the instance in this app window, and again only when a
// person asks (Refresh, Retry) or what it depends on changed (`again`). A part shown again (a tab
// turned back to) shows what was read: bb's query client would read a mounted query again once
// its answer is 2 s old, so the query is on only while it holds no answer. None is on a timer.
// What is left to bb: a read with no answer yet (in flight, or failed) is a query that is on, and
// bb reads those again when the window takes focus or the network returns while its own realtime
// connection is down.
import { useEffect, useRef, useState } from "react";
import { experimental_useRpcQuery as useRpcQuery, useRealtime } from "@get-bb/plugin-sdk/app";
import type { PluginRpcResult, StandardSchemaV1InferInput } from "@get-bb/plugin-sdk/app";
import { REALTIME_CHANGED, rpcContract } from "../../contract";
import { errorMessage, onWindowReset, type Read } from "../store";

type Contract = typeof rpcContract;
/** The panel's reads of one instance. */
export type PanelMethod = "panelInstance" | "panelSoul" | "panelEvents" | "panelReadiness";
export type PanelAnswer<Method extends PanelMethod> = PluginRpcResult<Contract[Method]>;
export type PanelRead<Method extends PanelMethod> = Read<PanelAnswer<Method>> & {
  /** Reads again now. */
  retry(): void;
  /** A read is in flight, the first one or a later one. */
  fetching: boolean;
  /** When the answer held was received, by this window's clock; null with none. */
  readAt: number | null;
};

/**
 * One of the panel's reads. `enabled: false` reads nothing until it is true (a read a person asks
 * for). `live`: read again when the server publishes `oats/changed`, and when a panel opens on an
 * answer bb still holds from an earlier visit (nothing told that copy what changed while the panel
 * was closed). A read that runs a command of its own is not live: it is read once, and again when
 * a person asks or `again` changes.
 */
function usePanelRead<Method extends PanelMethod>(
  method: Method,
  input: StandardSchemaV1InferInput<Contract[Method]["input"]>,
  { enabled = true, live = false, again = "" }: { enabled?: boolean; live?: boolean; again?: string } = {},
): PanelRead<Method> {
  // A read that runs a command starts off, is turned on once it is seen to hold no answer, and
  // off again when it has one: from then on it reads when told to.
  const [on, setOn] = useState(false);
  const query = useRpcQuery({ contract: rpcContract, method, input, enabled: enabled && (live || on) });
  const held = query.data !== undefined;
  useEffect(() => setOn(!held), [held]);
  const refetch = useRef(query.refetch);
  /** Reads again and notes when that read ended (`retry`, below), for the effects above it. */
  const reread = useRef<() => void>(() => undefined);
  useEffect(() => {
    refetch.current = query.refetch;
  });
  const heldAtMount = useRef(query.data !== undefined);
  useEffect(() => {
    if (live && heldAtMount.current) void refetch.current();
  }, [live]);
  // What the read depends on changed (the instance was started again, its soul moved): read again.
  // What the held answer was read for outlives the part (a tab turned away from), so a change
  // while it was off the page is seen when it comes back.
  const key = `${method} ${JSON.stringify(input)}`;
  const readFor = useRef(lastReadFor.get(key) ?? again);
  useEffect(() => {
    if (again !== "") lastReadFor.set(key, again);
    if (readFor.current === again) return;
    // The first value known is what the first read was for, not a change.
    const unknown = readFor.current === "";
    readFor.current = again;
    if (enabled && !unknown) reread.current();
  }, [again, enabled, key]);
  useRealtime(REALTIME_CHANGED, () => {
    if (live && enabled) void refetch.current();
  });
  const data = query.data as PanelAnswer<Method> | undefined;
  const fetching = query.isFetching;
  // When the answer held was last read: noted the first time it is seen, and again each time a
  // read asked for here ends with an answer (bb keeps the same object for an answer equal to the
  // last one, so the object alone does not say that it was read again). Kept for the part that is
  // shown again.
  if (data !== undefined && receivedAt.get(key)?.data !== data) receivedAt.set(key, { data, at: Date.now() });
  // The instant is kept by the read's key, not in this part: a read that ends while its part is
  // off the page (a tab turned away from) is noted when the part is back.
  const [, drawAgain] = useState(0);
  const answered = query.error === null && data !== undefined;
  const ended = endedAt.get(key);
  if (ended !== undefined && !fetching) {
    if (answered) receivedAt.set(key, { data, at: ended });
    endedAt.delete(key);
  }
  const readAt = data === undefined ? null : (receivedAt.get(key)?.at ?? null);
  const retry = () =>
    void refetch.current().then(() => {
      endedAt.set(key, Date.now());
      drawAgain((n) => n + 1);
    });
  reread.current = retry;
  if (query.error !== null) return { status: "error", data, error: errorMessage(query.error), retry, fetching, readAt };
  if (data === undefined) return { status: "loading", data: undefined, error: null, retry, fetching, readAt };
  return { status: "ready", data, error: null, retry, fetching, readAt };
}

/** What each read's held answer was read for (`again`), by method and input, in this app window. */
const lastReadFor = new Map<string, string>();
/** Each read's held answer and when it was received, by method and input, in this app window. */
const receivedAt = new Map<string, { data: unknown; at: number }>();
/** When the last read asked for here ended, by method and input, until the part that shows it has noted it. */
const endedAt = new Map<string, number>();
onWindowReset(() => {
  lastReadFor.clear();
  receivedAt.clear();
  endedAt.clear();
});

/** One instance's facts, from the roster the server holds: kept fresh, at no command's cost. */
export const usePanelInstance = (instance: string): PanelRead<"panelInstance"> => usePanelRead("panelInstance", { instance }, { live: true });
/** The soul as the instance was spawned from it (`oats inspect --home`): read when first shown, and again when `again` changes. */
export const usePanelSoul = (instance: string, again: string): PanelRead<"panelSoul"> => usePanelRead("panelSoul", { instance }, { again });
/** The instance's recorded lifecycle events (`oats instance events`): read only once a person asks. */
export const usePanelEvents = (instance: string, asked: boolean): PanelRead<"panelEvents"> => usePanelRead("panelEvents", { instance }, { enabled: asked });
/** `oats readiness` of the instance's home or of its soul: read when first shown, and again when a person asks. */
export const usePanelReadiness = (instance: string, of: "instance" | "soul"): PanelRead<"panelReadiness"> => usePanelRead("panelReadiness", { instance, of });

/**
 * The clock, read again every half minute while the panel is open: an agent that runs or waits
 * while nothing else changes in OATS causes no new read, and its ages must still grow.
 */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
