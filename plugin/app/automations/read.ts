// The lists as every slot of Automations reads them: one copy per app window (the page and the
// sidebar's mark share it). It is read again whenever the server says OATS changed, and on a timer
// while something shows it, since a run that fails writes no event the server watches for: every
// 30 s while the page is open, once a minute for the sidebar's mark alone.
import { useEffect, useRef } from "react";
import { experimental_useRpcQuery as useRpcQuery, useRpc } from "@get-bb/plugin-sdk/app";
import { rpcContract } from "../../contract";
import { attempt, onWindowReset, useRead } from "../store";
import type { Contract, Read, Result } from "../store";
import { FAILED_RUN_TEXT, lastRunFailed } from "./words";

/** The timer of the sidebar's mark, when no page is open: the Desktop rereads the lists for its mark this often. */
export const REREAD_MS = 60_000;
/** While the page shows the lists they are never older than this without saying so (the UX standard, freshness). */
export const PAGE_REREAD_MS = 30_000;

/** When this window last asked on its own clock: every slot shares the one timer's worth of reads. */
let rereadAt = 0;
onWindowReset(() => {
  rereadAt = 0;
});

export function useAutomations(every: number = REREAD_MS): Read<Result<"automations">> & { retry(): void; refresh(): Promise<void> } {
  const read = useRead("automations");
  const rpc = useRpc<Contract>();
  // The same shared copy, held for its `refetch`.
  const query = useRpcQuery({ contract: rpcContract, method: "automations", input: null });
  const refetch = useRef(query.refetch);
  useEffect(() => {
    refetch.current = query.refetch;
  });
  useEffect(() => {
    const timer = setInterval(() => {
      // Several slots share the one copy: whichever asks first asks for all.
      if (Date.now() - rereadAt < every - 1_000) return;
      rereadAt = Date.now();
      void refetch.current();
    }, every);
    return () => clearInterval(timer);
  }, [every]);
  /** Asks the server to read OATS again now, then reads the lists: settles when that read did, whatever it answered. */
  const refresh = (): Promise<void> => {
    // Whether or not the server could be asked to read OATS again, the lists' own read says what is.
    const reread = () => refetch.current();
    return attempt(() => rpc.call("refresh", null)).then(reread, reread);
  };
  return { ...read, refresh };
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
