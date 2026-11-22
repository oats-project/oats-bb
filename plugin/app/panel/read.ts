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
export type PanelMethod = "panelInstance" | "panelSoul" | "panelEvents" | "panelReadiness" | "panelBoard";
export type PanelAnswer<Method extends PanelMethod> = PluginRpcResult<Contract[Method]>;
export type PanelRead<Method extends PanelMethod> = Read<PanelAnswer<Method>> & {
  /** Reads again now. */
  retry(): void;
  /** A read is in flight, the first one or a later one. */
  fetching: boolean;
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
    if (enabled && !unknown) void refetch.current();
  }, [again, enabled, key]);
  useRealtime(REALTIME_CHANGED, () => {
    if (live && enabled) void refetch.current();
  });
  const data = query.data as PanelAnswer<Method> | undefined;
  const retry = () => void refetch.current();
  const fetching = query.isFetching;
  if (query.error !== null) return { status: "error", data, error: errorMessage(query.error), retry, fetching };
  if (data === undefined) return { status: "loading", data: undefined, error: null, retry, fetching };
  return { status: "ready", data, error: null, retry, fetching };
}

/** What each read's held answer was read for (`again`), by method and input, in this app window. */
const lastReadFor = new Map<string, string>();
onWindowReset(() => lastReadFor.clear());

/** One instance's facts, from the roster the server holds: kept fresh, at no command's cost. */
export const usePanelInstance = (instance: string): PanelRead<"panelInstance"> => usePanelRead("panelInstance", { instance }, { live: true });
/** The soul as the instance was spawned from it (`oats inspect --home`): read when first shown, and again when `again` changes. */
export const usePanelSoul = (instance: string, again: string): PanelRead<"panelSoul"> => usePanelRead("panelSoul", { instance }, { again });
/** The instance's recorded lifecycle events (`oats instance events`): read only once a person asks. */
export const usePanelEvents = (instance: string, asked: boolean): PanelRead<"panelEvents"> => usePanelRead("panelEvents", { instance }, { enabled: asked });
/** `oats readiness` of the instance's home or of its soul: read when first shown, and again when a person asks. */
export const usePanelReadiness = (instance: string, of: "instance" | "soul"): PanelRead<"panelReadiness"> => usePanelRead("panelReadiness", { instance, of });

/**
 * The board with each fact's history and each question's context (`oats inspect --home --board`):
 * read once there is something it would add (`wanted`), and again when `again` changes (a fact's
 * instant, a question with a context being asked).
 */
export const usePanelBoard = (instance: string, wanted: boolean, again: string): PanelRead<"panelBoard"> => usePanelRead("panelBoard", { instance }, { enabled: wanted, again });

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
