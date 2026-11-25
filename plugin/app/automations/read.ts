// The lists as every slot of Automations reads them: one copy per app window (the page and the
// sidebar's mark share it). It is read again whenever the server says OATS changed, and on a timer
// while something shows it, since a run that fails writes no event the server watches for: every
// 30 s while the page is open, once a minute for the sidebar's mark alone.
import { useEffect, useRef } from "react";
import { experimental_useRpcQuery as useRpcQuery, useRpc } from "@get-bb/plugin-sdk/app";
import { rpcContract } from "../../contract";
import { attempt, onWindowReset, useRead } from "../store";
import type { Contract, Read, Result } from "../store";
import type { AutomationKind } from "../../contract/automations";
import { FAILED_RUN_TEXT, failing, statusFor } from "./words";

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
 * The sidebar row's mark: while an automation is failing (words.ts `failing`: its row's small line
 * ends in red), the row carries a dot and is announced "Automations, a failure". The verdict is of
 * a whole read (both lists); a list that could not be read keeps the last verdict of its own rows,
 * and before the first read there is no mark.
 */
export function useFailedRunMark(): { label: string } | null {
  const read = useAutomations();
  const statuses = read.data?.statuses;
  const kept = useRef<Record<AutomationKind, boolean>>({ schedule: false, trigger: false });
  for (const kind of ["schedule", "trigger"] as const) {
    const answer = read.data?.[kind];
    if (answer === undefined || !answer.ok) continue;
    // A trigger's failed poll or spawn is read from its state: while that could not be read, the verdict of the triggers stands as it was.
    if (kind === "trigger" && (statuses === undefined || !statuses.ok)) continue;
    kept.current[kind] = answer.list.rows.some((row) => failing(row, statusFor(row, statuses !== undefined && statuses.ok ? statuses.statuses : null)));
  }
  return kept.current.schedule || kept.current.trigger ? { label: `Automations${FAILED_RUN_TEXT}` } : null;
}
