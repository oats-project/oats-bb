// The lists as every slot of Automations reads them: one copy per app window (the page and the
// sidebar's mark share it), reread when the server says OATS changed, and once a minute while
// something shows them: a run that fails writes no event the server watches for.
import { useEffect, useRef } from "react";
import { experimental_useRpcQuery as useRpcQuery } from "@get-bb/plugin-sdk/app";
import { rpcContract } from "../../contract";
import { onWindowReset, useRead } from "../store";
import type { Read, Result } from "../store";
import { FAILED_RUN_TEXT, lastRunFailed } from "./words";

/** The Desktop rereads the lists for its mark at most this often. */
export const REREAD_MS = 60_000;

/** When this window last asked on its own clock: every slot shares the one timer's worth of reads. */
let rereadAt = 0;
onWindowReset(() => {
  rereadAt = 0;
});

export function useAutomations(): Read<Result<"automations">> & { retry(): void } {
  const read = useRead("automations");
  // The same shared copy, held for its `refetch`.
  const query = useRpcQuery({ contract: rpcContract, method: "automations", input: null });
  const refetch = useRef(query.refetch);
  useEffect(() => {
    refetch.current = query.refetch;
  });
  useEffect(() => {
    const timer = setInterval(() => {
      if (Date.now() - rereadAt < REREAD_MS) return;
      rereadAt = Date.now();
      void refetch.current();
    }, REREAD_MS);
    return () => clearInterval(timer);
  }, []);
  return read;
}

/**
 * The sidebar row's mark: while a schedule's last run is launch failed or invalid, the row
 * carries a dot and is announced "Automations, a run failed". A read that failed keeps the last
 * verdict; before the first read there is no mark.
 */
export function useFailedRunMark(): { label: string } | null {
  const read = useAutomations();
  const schedule = read.data?.schedule;
  const verdict = useRef(false);
  if (schedule !== undefined && schedule.ok) verdict.current = schedule.list.rows.some(lastRunFailed);
  return verdict.current ? { label: `Automations${FAILED_RUN_TEXT}` } : null;
}
