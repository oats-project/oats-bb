// One of the panel's reads of one instance, kept fresh: loaded when the instance is shown and
// reread when the server publishes `oats/changed` (app/store.ts says how the plugin's reads work).
import { useEffect, useRef, useState } from "react";
import { experimental_useRpcQuery as useRpcQuery, useRealtime } from "@get-bb/plugin-sdk/app";
import type { PluginRpcResult } from "@get-bb/plugin-sdk/app";
import { REALTIME_CHANGED, rpcContract } from "../../contract";
import { errorMessage, type Read } from "../store";

type Contract = typeof rpcContract;
type InstanceAnswer = PluginRpcResult<Contract["panelInstance"]>;

/**
 * One instance's facts, kept fresh: read when the instance is shown, again when the server
 * publishes `oats/changed`, and again when a panel opens on an answer bb still holds from an
 * earlier visit (nothing told that copy what changed while the panel was closed).
 */
export function usePanelInstance(instance: string): Read<InstanceAnswer> & { retry(): void; fetching: boolean } {
  const query = useRpcQuery({ contract: rpcContract, method: "panelInstance", input: { instance } });
  const refetch = useRef(query.refetch);
  useEffect(() => {
    refetch.current = query.refetch;
  });
  const heldAtMount = useRef(query.data !== undefined);
  useEffect(() => {
    if (heldAtMount.current) void refetch.current();
  }, []);
  useRealtime(REALTIME_CHANGED, () => void refetch.current());
  const data = query.data as InstanceAnswer | undefined;
  const retry = () => void refetch.current();
  const fetching = query.isFetching;
  if (query.error !== null) return { status: "error", data, error: errorMessage(query.error), retry, fetching };
  if (data === undefined) return { status: "loading", data: undefined, error: null, retry, fetching };
  return { status: "ready", data, error: null, retry, fetching };
}

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
