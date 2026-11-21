// One of the panel's reads of one instance, kept fresh: loaded when the instance is shown and
// reread when the server publishes `oats/changed` (app/store.ts says how the plugin's reads work).
import { useEffect, useRef, useState } from "react";
import { experimental_useRpcQuery as useRpcQuery, useRealtime } from "@get-bb/plugin-sdk/app";
import type { PluginRpcResult } from "@get-bb/plugin-sdk/app";
import { REALTIME_CHANGED, rpcContract } from "../../contract";
import { errorMessage, type Read } from "../store";

type Contract = typeof rpcContract;
/** The panel's verbs that read one instance. */
export type InstanceRead = "panelInstance";

export function useInstanceRead<Method extends InstanceRead>(method: Method, instance: string, enabled = true): Read<PluginRpcResult<Contract[Method]>> & { retry(): void } {
  const query = useRpcQuery({ contract: rpcContract, method, input: { instance }, enabled });
  const refetch = useRef(query.refetch);
  useEffect(() => {
    refetch.current = query.refetch;
  });
  useRealtime(REALTIME_CHANGED, () => {
    if (enabled) void refetch.current();
  });
  const data = query.data as PluginRpcResult<Contract[Method]> | undefined;
  const retry = () => void refetch.current();
  if (query.error !== null) return { status: "error", data, error: errorMessage(query.error), retry };
  if (data === undefined) return { status: "loading", data: undefined, error: null, retry };
  return { status: "ready", data, error: null, retry };
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
