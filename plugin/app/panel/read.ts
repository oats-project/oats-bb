// The panel's reads of one instance (app/store.ts says how the plugin's reads work): the facts of
// the roster's row, kept fresh, and the reads that run a command of their own, read when shown.
// "When shown" is the first time a part is on the page: whether a part shown again (a tab turned
// back to) reads again is bb's query client's call, and none of these reads is on a timer.
import { useEffect, useRef, useState } from "react";
import { experimental_useRpcQuery as useRpcQuery, useRealtime } from "@get-bb/plugin-sdk/app";
import type { PluginRpcResult, StandardSchemaV1InferInput } from "@get-bb/plugin-sdk/app";
import { REALTIME_CHANGED, rpcContract } from "../../contract";
import { errorMessage, type Read } from "../store";

type Contract = typeof rpcContract;
/** The panel's reads of one instance. */
export type PanelMethod = "panelInstance" | "panelSoul" | "panelEvents" | "panelReadiness";
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
  const query = useRpcQuery({ contract: rpcContract, method, input, enabled });
  const refetch = useRef(query.refetch);
  useEffect(() => {
    refetch.current = query.refetch;
  });
  const heldAtMount = useRef(query.data !== undefined);
  useEffect(() => {
    if (live && heldAtMount.current) void refetch.current();
  }, [live]);
  // What the read depends on changed (the instance was started again, its soul moved): read again.
  const readFor = useRef(again);
  useEffect(() => {
    if (readFor.current === again) return;
    // The first value known is what the first read was for, not a change.
    const first = readFor.current === "";
    readFor.current = again;
    if (enabled && !first) void refetch.current();
  }, [again, enabled]);
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

/** One instance's facts, from the roster the server holds: kept fresh, at no command's cost. */
export const usePanelInstance = (instance: string): PanelRead<"panelInstance"> => usePanelRead("panelInstance", { instance }, { live: true });
/** The soul as the instance was spawned from it (`oats inspect --home`): read when shown, and again when `again` changes. */
export const usePanelSoul = (instance: string, again: string): PanelRead<"panelSoul"> => usePanelRead("panelSoul", { instance }, { again });
/** The instance's recorded lifecycle events (`oats instance events`): read only once a person asks. */
export const usePanelEvents = (instance: string, asked: boolean): PanelRead<"panelEvents"> => usePanelRead("panelEvents", { instance }, { enabled: asked });
/** `oats readiness` of the instance's home or of its soul: read when shown, and again when a person asks. */
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
